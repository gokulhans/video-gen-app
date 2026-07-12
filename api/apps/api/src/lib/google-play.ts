import type { Env } from "../env";

type ServiceAccount = {
	client_email: string;
	private_key: string;
	token_uri?: string;
};

/**
 * TODO(secrets): `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` must hold the full JSON
 * key for a service account with the "Pub/Sub Notifications and Play
 * Developer Reporting" / "View financial data" role granted in Play Console
 * (Setup > API access). The private key (`private_key` field, PKCS#8 PEM)
 * is the sensitive bit — set it via `wrangler secret put
 * GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` with the whole JSON blob, never commit it.
 */
function loadServiceAccount(env: Env): ServiceAccount {
	return JSON.parse(env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON) as ServiceAccount;
}

function base64url(input: ArrayBuffer | string): string {
	const bytes =
		typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
	let str = "";
	for (const b of bytes) str += String.fromCharCode(b);
	return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
	const b64 = pem
		.replace(/-----BEGIN PRIVATE KEY-----/, "")
		.replace(/-----END PRIVATE KEY-----/, "")
		.replace(/\s+/g, "");
	const binary = atob(b64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes.buffer;
}

/**
 * Signs a Google service-account JWT (RS256) for the OAuth2 assertion flow
 * and exchanges it for an access token. Structure is complete; the only
 * missing piece in production is the actual private key value in the
 * `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` secret (see TODO above).
 */
async function getAccessToken(env: Env, scope: string): Promise<string> {
	const sa = loadServiceAccount(env);
	const tokenUri = sa.token_uri ?? "https://oauth2.googleapis.com/token";

	const header = { alg: "RS256", typ: "JWT" };
	const now = Math.floor(Date.now() / 1000);
	const claimSet = {
		iss: sa.client_email,
		scope,
		aud: tokenUri,
		exp: now + 3600,
		iat: now,
	};

	const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claimSet))}`;

	const key = await crypto.subtle.importKey(
		"pkcs8",
		pemToArrayBuffer(sa.private_key),
		{ name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
		false,
		["sign"],
	);
	const signature = await crypto.subtle.sign(
		"RSASSA-PKCS1-v1_5",
		key,
		new TextEncoder().encode(unsigned),
	);
	const jwt = `${unsigned}.${base64url(signature)}`;

	const res = await fetch(tokenUri, {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
			assertion: jwt,
		}),
	});
	if (!res.ok) {
		throw new Error(`Failed to obtain Google access token: ${res.status} ${await res.text()}`);
	}
	const json = (await res.json()) as { access_token: string };
	return json.access_token;
}

export type PlayPurchaseState = {
	valid: boolean;
	acknowledged: boolean;
	purchaseState: number;
	orderId?: string;
	raw: unknown;
};

/**
 * Verifies a Google Play Billing purchase token against the Android
 * Publisher API: `products.get` (for consumable/managed one-time products).
 * https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.products/get
 */
export async function verifyPlayPurchase(
	env: Env,
	productId: string,
	purchaseToken: string,
): Promise<PlayPurchaseState> {
	const accessToken = await getAccessToken(
		env,
		"https://www.googleapis.com/auth/androidpublisher",
	);

	const url =
		`https://androidpublisher.googleapis.com/androidpublisher/v3/applications/` +
		`${env.GOOGLE_PLAY_PACKAGE_NAME}/purchases/products/${productId}/tokens/${purchaseToken}`;

	const res = await fetch(url, {
		headers: { authorization: `Bearer ${accessToken}` },
	});
	if (!res.ok) {
		return { valid: false, acknowledged: false, purchaseState: -1, raw: await res.text() };
	}
	const json = (await res.json()) as { purchaseState: number; acknowledgementState: number; orderId?: string };
	return {
		valid: json.purchaseState === 0, // 0 = purchased
		acknowledged: json.acknowledgementState === 1,
		purchaseState: json.purchaseState,
		orderId: json.orderId,
		raw: json,
	};
}

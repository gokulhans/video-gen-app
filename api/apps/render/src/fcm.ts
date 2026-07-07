/**
 * Self-contained Firebase Cloud Messaging (HTTP v1) helper.
 *
 * No firebase-admin dependency (it isn't Workers-compatible) — this builds
 * the OAuth2 JWT assertion by hand with WebCrypto and exchanges it for an
 * access token, then POSTs to the FCM v1 send endpoint.
 *
 * `FCM_SERVICE_ACCOUNT_JSON` secret must contain the full service-account
 * JSON downloaded from the Firebase console (has `client_email`,
 * `private_key`, `project_id`).
 */

interface ServiceAccount {
	client_email: string;
	private_key: string;
	project_id: string;
}

interface CachedToken {
	accessToken: string;
	expiresAt: number; // epoch ms
}

// Module-level cache — survives across invocations within the same isolate.
let cachedToken: CachedToken | null = null;

function base64url(input: ArrayBuffer | string): string {
	let bytes: Uint8Array;
	if (typeof input === "string") {
		bytes = new TextEncoder().encode(input);
	} else {
		bytes = new Uint8Array(input);
	}
	let binary = "";
	for (const b of bytes) binary += String.fromCharCode(b);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
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

async function signJwt(sa: ServiceAccount): Promise<string> {
	const nowSec = Math.floor(Date.now() / 1000);
	const header = { alg: "RS256", typ: "JWT" };
	const claims = {
		iss: sa.client_email,
		scope: "https://www.googleapis.com/auth/firebase.messaging",
		aud: "https://oauth2.googleapis.com/token",
		iat: nowSec,
		exp: nowSec + 3600,
	};

	const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;

	const key = await crypto.subtle.importKey(
		"pkcs8",
		pemToArrayBuffer(sa.private_key),
		{ name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
		false,
		["sign"],
	);

	const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));

	return `${unsigned}.${base64url(signature)}`;
}

async function getAccessToken(env: { FCM_SERVICE_ACCOUNT_JSON: string }): Promise<{ accessToken: string; projectId: string }> {
	const sa: ServiceAccount = JSON.parse(env.FCM_SERVICE_ACCOUNT_JSON);

	if (cachedToken && cachedToken.expiresAt - 60_000 > Date.now()) {
		return { accessToken: cachedToken.accessToken, projectId: sa.project_id };
	}

	const jwt = await signJwt(sa);
	const res = await fetch("https://oauth2.googleapis.com/token", {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
			assertion: jwt,
		}),
	});

	if (!res.ok) {
		throw new Error(`FCM token exchange failed: ${res.status} ${await res.text()}`);
	}

	const json = (await res.json()) as { access_token: string; expires_in: number };
	cachedToken = {
		accessToken: json.access_token,
		expiresAt: Date.now() + json.expires_in * 1000,
	};

	return { accessToken: cachedToken.accessToken, projectId: sa.project_id };
}

export interface FcmPushInput {
	token: string;
	title: string;
	body: string;
	data?: Record<string, string>;
}

/**
 * Sends a single FCM push. Swallows and logs errors — a push failure should
 * never fail the render pipeline (notification row is already durable in D1).
 */
export async function sendFcmPush(env: { FCM_SERVICE_ACCOUNT_JSON: string }, input: FcmPushInput): Promise<boolean> {
	try {
		const { accessToken, projectId } = await getAccessToken(env);

		const res = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
			method: "POST",
			headers: {
				authorization: `Bearer ${accessToken}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({
				message: {
					token: input.token,
					notification: { title: input.title, body: input.body },
					data: input.data ?? {},
				},
			}),
		});

		if (!res.ok) {
			console.error("FCM send failed", res.status, await res.text());
			return false;
		}
		return true;
	} catch (err) {
		console.error("FCM send threw", err);
		return false;
	}
}

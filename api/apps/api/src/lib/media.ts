import type { Env } from "../env";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@app/db";

export const UPLOAD_URL_TTL_SECONDS = 10 * 60;
export const PROVIDER_FETCH_TTL_SECONDS = 24 * 60 * 60;
export const GENERATION_MASTER_INGEST_TTL_SECONDS = 15 * 60;

export type UploadKind = "image" | "audio" | "video";

export type MediaUploadRecord = {
	assetId: string;
	userId: string;
	objectKey: string;
	kind: UploadKind;
	contentType: string;
	declaredSizeBytes: number;
	actualSizeBytes?: number;
	status: "pending" | "ready" | "rejected";
	createdAt: number;
	readyAt?: number;
};

const RULES: Record<UploadKind, { contentTypes: readonly string[]; maxBytes: number }> = {
	image: { contentTypes: ["image/jpeg", "image/png", "image/webp"], maxBytes: 15 * 1024 * 1024 },
	audio: { contentTypes: ["audio/mpeg", "audio/wav", "audio/mp4"], maxBytes: 50 * 1024 * 1024 },
	video: { contentTypes: ["video/mp4", "video/webm"], maxBytes: 250 * 1024 * 1024 },
};

const EXTENSIONS: Record<string, string> = {
	"image/jpeg": "jpg",
	"image/png": "png",
	"image/webp": "webp",
	"audio/mpeg": "mp3",
	"audio/wav": "wav",
	"audio/mp4": "m4a",
	"video/mp4": "mp4",
	"video/webm": "webm",
};

export function validateUploadDeclaration(kind: UploadKind, contentType: string, sizeBytes: number): string | null {
	const rule = RULES[kind];
	if (!rule.contentTypes.includes(contentType)) return `${contentType} is not supported for ${kind} uploads`;
	if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) return "sizeBytes must be a positive integer";
	if (sizeBytes > rule.maxBytes) return `${kind} uploads may not exceed ${rule.maxBytes} bytes`;
	return null;
}

export function uploadExtension(contentType: string): string | null {
	return EXTENSIONS[contentType] ?? null;
}

export function isPrivateUploadAssetKey(key: string): boolean {
	const parts = key.split("/");
	return parts.includes("uploads") || parts.includes("user-uploads");
}

export function isGenerationMasterAssetKey(key: string): boolean {
	return /^users\/[A-Za-z0-9_-]+\/generation-jobs\/[A-Za-z0-9_-]+\/master\.mp4$/.test(key);
}

export function isSafeAssetKey(key: string): boolean {
	return key.length > 0
		&& key.length <= 1_024
		&& !key.startsWith("/")
		&& key.split("/").every((part) => part.length > 0 && part !== "." && part !== "..");
}

function base64UrlEncode(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string): Uint8Array | null {
	if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
	try {
		const normalized = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
		const binary = atob(normalized);
		return Uint8Array.from(binary, (character) => character.charCodeAt(0));
	} catch {
		return null;
	}
}

async function mediaSigningKey(secret: string): Promise<CryptoKey> {
	if (secret.length < 32) throw new Error("media_signing_secret_unavailable");
	return crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign", "verify"],
	);
}

export async function createGenerationMasterIngestToken(
	secret: string,
	objectKey: string,
	nowSeconds = Math.floor(Date.now() / 1000),
): Promise<string> {
	if (!isGenerationMasterAssetKey(objectKey)) throw new Error("invalid_generation_master_key");
	const payload = base64UrlEncode(new TextEncoder().encode(JSON.stringify({
		v: 1,
		k: objectKey,
		e: nowSeconds + GENERATION_MASTER_INGEST_TTL_SECONDS,
	})));
	const signature = new Uint8Array(await crypto.subtle.sign(
		"HMAC",
		await mediaSigningKey(secret),
		new TextEncoder().encode(`generation-master:v1:${payload}`),
	));
	return `${payload}.${base64UrlEncode(signature)}`;
}

export async function verifyGenerationMasterIngestToken(
	secret: string,
	token: string,
	nowSeconds = Math.floor(Date.now() / 1000),
): Promise<string | null> {
	const [payload, signatureValue, extra] = token.split(".");
	if (!payload || !signatureValue || extra !== undefined || token.length > 2048) return null;
	const signature = base64UrlDecode(signatureValue);
	const payloadBytes = base64UrlDecode(payload);
	if (!signature || !payloadBytes) return null;
	const valid = await crypto.subtle.verify(
		"HMAC",
		await mediaSigningKey(secret),
		signature,
		new TextEncoder().encode(`generation-master:v1:${payload}`),
	);
	if (!valid) return null;
	try {
		const decoded = JSON.parse(new TextDecoder().decode(payloadBytes)) as { v?: unknown; k?: unknown; e?: unknown };
		if (decoded.v !== 1 || typeof decoded.k !== "string" || !isGenerationMasterAssetKey(decoded.k)) return null;
		if (!Number.isSafeInteger(decoded.e) || (decoded.e as number) <= nowSeconds) return null;
		return decoded.k;
	} catch {
		return null;
	}
}

export async function createProviderFetchToken(env: Pick<Env, "BETTER_AUTH_SECRET">, assetId: string): Promise<string> {
	const payload = base64UrlEncode(new TextEncoder().encode(JSON.stringify({
		v: 1,
		a: assetId,
		e: Math.floor(Date.now() / 1000) + PROVIDER_FETCH_TTL_SECONDS,
	})));
	const message = new TextEncoder().encode(`media-fetch:v1:${payload}`);
	const signature = new Uint8Array(await crypto.subtle.sign("HMAC", await mediaSigningKey(env.BETTER_AUTH_SECRET), message));
	return `${payload}.${base64UrlEncode(signature)}`;
}

export async function verifyProviderFetchToken(
	secret: string,
	token: string,
	nowSeconds = Math.floor(Date.now() / 1000),
): Promise<string | null> {
	const [payload, signatureValue, extra] = token.split(".");
	if (!payload || !signatureValue || extra !== undefined || token.length > 512) return null;
	const signature = base64UrlDecode(signatureValue);
	const payloadBytes = base64UrlDecode(payload);
	if (!signature || !payloadBytes) return null;
	const valid = await crypto.subtle.verify(
		"HMAC",
		await mediaSigningKey(secret),
		signature,
		new TextEncoder().encode(`media-fetch:v1:${payload}`),
	);
	if (!valid) return null;
	try {
		const decoded = JSON.parse(new TextDecoder().decode(payloadBytes)) as { v?: unknown; a?: unknown; e?: unknown };
		if (decoded.v !== 1 || typeof decoded.a !== "string" || !/^[A-Za-z0-9_-]{8,128}$/.test(decoded.a)) return null;
		if (!Number.isSafeInteger(decoded.e) || (decoded.e as number) <= nowSeconds) return null;
		return decoded.a;
	} catch {
		return null;
	}
}

export async function createUploadRegistration(
	env: Env,
	input: Omit<MediaUploadRecord, "assetId" | "status" | "createdAt">,
): Promise<{ record: MediaUploadRecord; token: string }> {
	const assetId = crypto.randomUUID();
	const record: MediaUploadRecord = {
		...input,
		assetId,
		status: "pending",
		createdAt: Date.now(),
	};
	await getDb(env.DB).insert(schema.userUploadAssets).values({
		id: record.assetId,
		userId: record.userId,
		objectKey: record.objectKey,
		kind: record.kind,
		contentType: record.contentType,
		declaredSize: record.declaredSizeBytes,
		status: "pending",
		createdAt: record.createdAt,
		updatedAt: record.createdAt,
	});
	const token = await createProviderFetchToken(env, assetId);
	return { record, token };
}

export async function loadUploadRegistration(env: Env, assetId: string): Promise<MediaUploadRecord | null> {
	const row = await getDb(env.DB).select().from(schema.userUploadAssets)
		.where(eq(schema.userUploadAssets.id, assetId)).get();
	if (!row || !["pending", "ready", "rejected"].includes(row.status) || !(row.kind in RULES)) return null;
	return {
		assetId: row.id,
		userId: row.userId,
		objectKey: row.objectKey,
		kind: row.kind as UploadKind,
		contentType: row.contentType,
		declaredSizeBytes: row.declaredSize,
		actualSizeBytes: row.actualSize ?? undefined,
		status: row.status as MediaUploadRecord["status"],
		createdAt: row.createdAt,
		readyAt: row.finalizedAt ?? undefined,
	};
}

export async function loadUploadByObjectKey(env: Env, objectKey: string): Promise<MediaUploadRecord | null> {
	const row = await getDb(env.DB).select({ id: schema.userUploadAssets.id }).from(schema.userUploadAssets)
		.where(eq(schema.userUploadAssets.objectKey, objectKey)).get();
	return row ? loadUploadRegistration(env, row.id) : null;
}

export async function loadUploadByFetchToken(env: Env, token: string): Promise<MediaUploadRecord | null> {
	const assetId = await verifyProviderFetchToken(env.BETTER_AUTH_SECRET, token);
	return assetId ? loadUploadRegistration(env, assetId) : null;
}

export async function finalizeUploadRegistration(env: Env, record: MediaUploadRecord): Promise<MediaUploadRecord> {
	if (record.status === "rejected") throw new Error("upload_rejected");
	const object = await env.UPLOADS_BUCKET.head(record.objectKey);
	if (!object) throw new Error("upload_missing");
	if (object.size !== record.declaredSizeBytes) {
		await getDb(env.DB).update(schema.userUploadAssets).set({
			actualSize: object.size, status: "rejected", updatedAt: Date.now(),
		}).where(eq(schema.userUploadAssets.id, record.assetId));
		await env.UPLOADS_BUCKET.delete(record.objectKey);
		throw new Error("upload_size_mismatch");
	}
	if (object.httpMetadata?.contentType !== record.contentType) {
		await getDb(env.DB).update(schema.userUploadAssets).set({
			actualSize: object.size, status: "rejected", updatedAt: Date.now(),
		}).where(eq(schema.userUploadAssets.id, record.assetId));
		await env.UPLOADS_BUCKET.delete(record.objectKey);
		throw new Error("upload_content_type_mismatch");
	}
	const now = Date.now();
	const ready: MediaUploadRecord = {
		...record,
		actualSizeBytes: object.size,
		status: "ready",
		readyAt: record.readyAt ?? now,
	};
	await getDb(env.DB).update(schema.userUploadAssets).set({
		actualSize: object.size,
		status: "ready",
		updatedAt: now,
		finalizedAt: ready.readyAt,
	}).where(eq(schema.userUploadAssets.id, record.assetId));
	return ready;
}

export async function ensureUploadReady(env: Env, record: MediaUploadRecord): Promise<MediaUploadRecord> {
	return finalizeUploadRegistration(env, record);
}

export function providerFetchUrl(env: Env, token: string): string {
	return `${env.APP_BASE_URL.replace(/\/$/, "")}/media/input/${token}`;
}

export function streamPlaybackUrls(customerCode: string, token: string): { hls: string; dash: string } | null {
	if (!/^[a-z0-9]+$/i.test(customerCode) || customerCode === "replace-with-stream-customer-code") return null;
	if (!/^[A-Za-z0-9._~-]+$/.test(token)) return null;
	const base = `https://customer-${customerCode}.cloudflarestream.com/${token}/manifest`;
	return { hls: `${base}/video.m3u8`, dash: `${base}/video.mpd` };
}

export function streamVideoOwnedByGeneration(
	video: { creator?: unknown; meta?: unknown },
	userId: string,
	jobId: string,
): boolean {
	if (video.creator !== userId || !video.meta || typeof video.meta !== "object" || Array.isArray(video.meta)) return false;
	return (video.meta as Record<string, unknown>).generationJobId === jobId;
}

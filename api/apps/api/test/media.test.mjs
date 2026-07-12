import assert from "node:assert/strict";
import test from "node:test";
import {
	createProviderFetchToken,
	createGenerationMasterIngestToken,
	isGenerationMasterAssetKey,
	isPrivateUploadAssetKey,
	isSafeAssetKey,
	streamPlaybackUrls,
	streamVideoOwnedByGeneration,
	uploadExtension,
	validateUploadDeclaration,
	verifyProviderFetchToken,
	verifyGenerationMasterIngestToken,
} from "../src/lib/media.ts";
import { generationMasterIngestUrl } from "../../pipeline/src/generation-ingest.ts";

test("upload declarations bind kind, MIME type, and exact maximum", () => {
	assert.equal(validateUploadDeclaration("image", "image/png", 1024), null);
	assert.match(validateUploadDeclaration("image", "audio/mpeg", 1024), /not supported/);
	assert.match(validateUploadDeclaration("image", "image/png", 15 * 1024 * 1024 + 1), /may not exceed/);
	assert.match(validateUploadDeclaration("audio", "audio/wav", 0), /positive integer/);
	assert.equal(uploadExtension("video/mp4"), "mp4");
	assert.equal(uploadExtension("application/octet-stream"), null);
});

test("generation master ingest tokens bind path, reject tampering, and expire", async () => {
	const secret = "test-generation-ingest-secret-at-least-32-bytes";
	const key = "users/user_123/generation-jobs/job_123/master.mp4";
	assert.equal(isGenerationMasterAssetKey(key), true);
	const token = await createGenerationMasterIngestToken(secret, key, 1_000);
	assert.equal(await verifyGenerationMasterIngestToken(secret, token, 1_001), key);
	const [payload, signature] = token.split(".");
	const tampered = `${payload}.${signature.slice(0, -1)}${signature.endsWith("A") ? "B" : "A"}`;
	assert.equal(await verifyGenerationMasterIngestToken(secret, tampered, 1_001), null);
	assert.equal(await verifyGenerationMasterIngestToken(secret, token, 1_901), null);
	await assert.rejects(() => createGenerationMasterIngestToken(secret, "users/user_123/other.mp4", 1_000), /invalid_generation_master_key/);
	const pipelineUrl = await generationMasterIngestUrl("https://api.example.com", secret, key, 1_000);
	const pipelineToken = pipelineUrl.slice(pipelineUrl.lastIndexOf("/") + 1);
	assert.equal(await verifyGenerationMasterIngestToken(secret, pipelineToken, 1_001), key);
});

test("Stream playback URLs use a signed token and configured customer code", () => {
	assert.deepEqual(streamPlaybackUrls("abc123", "signed.token_123"), {
		hls: "https://customer-abc123.cloudflarestream.com/signed.token_123/manifest/video.m3u8",
		dash: "https://customer-abc123.cloudflarestream.com/signed.token_123/manifest/video.mpd",
	});
	assert.equal(streamPlaybackUrls("replace-with-stream-customer-code", "signed.token_123"), null);
	assert.equal(streamPlaybackUrls("abc123", "bad/token"), null);
});

test("Stream ownership metadata is checked defensively", () => {
	assert.equal(streamVideoOwnedByGeneration({ creator: "user_1", meta: { generationJobId: "job_1" } }, "user_1", "job_1"), true);
	assert.equal(streamVideoOwnedByGeneration({ creator: null, meta: { generationJobId: "job_1" } }, "user_1", "job_1"), false);
	assert.equal(streamVideoOwnedByGeneration({ creator: "user_1", meta: null }, "user_1", "job_1"), false);
});

test("public asset route rejects upload namespaces and traversal-shaped keys", () => {
	assert.equal(isPrivateUploadAssetKey("user-uploads/user/file.png"), true);
	assert.equal(isPrivateUploadAssetKey("legacy-user/uploads/image/file.png"), true);
	assert.equal(isPrivateUploadAssetKey("users/user/generation-jobs/job/master.mp4"), false);
	assert.equal(isSafeAssetKey("users/user/generation-jobs/job/master.mp4"), true);
	assert.equal(isSafeAssetKey("users/user/../secret"), false);
	assert.equal(isSafeAssetKey("/absolute"), false);
});

test("provider fetch tokens are self-contained, signed, and expiring", async () => {
	const secret = "test-media-signing-secret-at-least-32-bytes";
	const assetId = "asset_12345678";
	const token = await createProviderFetchToken({ BETTER_AUTH_SECRET: secret }, assetId);
	assert.equal(await verifyProviderFetchToken(secret, token), assetId);
	const [payload, signature] = token.split(".");
	const tampered = `${payload}.${signature.slice(0, -1)}${signature.endsWith("A") ? "B" : "A"}`;
	assert.equal(await verifyProviderFetchToken(secret, tampered), null);
	assert.equal(
		await verifyProviderFetchToken(secret, token, Math.floor(Date.now() / 1000) + 24 * 60 * 60 + 1),
		null,
	);
});

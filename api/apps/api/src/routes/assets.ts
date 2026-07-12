import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@app/db";
import type { AppEnv } from "../env";
import {
	createProviderFetchToken,
	createUploadRegistration,
	ensureUploadReady,
	loadUploadByObjectKey,
	loadUploadRegistration,
	PROVIDER_FETCH_TTL_SECONDS,
	providerFetchUrl,
	streamPlaybackUrls,
	streamVideoOwnedByGeneration,
	UPLOAD_URL_TTL_SECONDS,
	uploadExtension,
	validateUploadDeclaration,
} from "../lib/media";
import { Errors, okJson } from "../lib/response";
import { presignGet, presignPut, type PresignBucket } from "../lib/r2";

export const assets = new Hono<AppEnv>();

const UploadUrlBody = z.object({
	kind: z.enum(["image", "audio", "video"]),
	contentType: z.string().min(1),
	sizeBytes: z.number().int().positive(),
}).strict();

assets.post("/upload-url", zValidator("json", UploadUrlBody), async (c) => {
	const userId = c.get("userId");
	const { kind, contentType, sizeBytes } = c.req.valid("json");
	const validationError = validateUploadDeclaration(kind, contentType, sizeBytes);
	if (validationError) return Errors.validation(c, validationError);
	const extension = uploadExtension(contentType);
	if (!extension) return Errors.validation(c, "Unsupported upload content type");

	const objectKey = `user-uploads/${userId}/${crypto.randomUUID()}.${extension}`;
	const { record, token } = await createUploadRegistration(c.env, {
		userId,
		objectKey,
		kind,
		contentType,
		declaredSizeBytes: sizeBytes,
	});
	const uploadUrl = await presignPut(c.env, "uploads", objectKey, contentType, UPLOAD_URL_TTL_SECONDS);

	return okJson(c, {
		assetId: record.assetId,
		uploadUrl,
		key: objectKey,
		assetKey: objectKey,
		// Kept for the current Flutter response shape. This is an opaque,
		// expiring Worker URL, not a permanent public /assets URL.
		publicUrl: providerFetchUrl(c.env, token),
		providerFetchUrl: providerFetchUrl(c.env, token),
		bucket: "uploads",
		status: record.status,
		expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
		providerFetchExpiresInSeconds: PROVIDER_FETCH_TTL_SECONDS,
	}, 201);
});

// Character sources do not need a provider fetch token at upload time. This
// endpoint keeps biometric inputs private and returns only the R2 PUT target
// plus the opaque asset id used after finalization.
assets.post("/upload-private-url", zValidator("json", UploadUrlBody), async (c) => {
	const userId = c.get("userId");
	const { kind, contentType, sizeBytes } = c.req.valid("json");
	const validationError = validateUploadDeclaration(kind, contentType, sizeBytes);
	if (validationError) return Errors.validation(c, validationError);
	const extension = uploadExtension(contentType);
	if (!extension) return Errors.validation(c, "Unsupported upload content type");
	const objectKey = `user-uploads/${userId}/${crypto.randomUUID()}.${extension}`;
	const { record } = await createUploadRegistration(c.env, {
		userId, objectKey, kind, contentType, declaredSizeBytes: sizeBytes,
	});
	await getDb(c.env.DB).update(schema.userUploadAssets).set({
		purpose: "character_source",
		cleanupAfter: Date.now() + 24 * 60 * 60 * 1000,
	}).where(and(eq(schema.userUploadAssets.id, record.assetId), eq(schema.userUploadAssets.userId, userId)));
	const uploadUrl = await presignPut(c.env, "uploads", objectKey, contentType, UPLOAD_URL_TTL_SECONDS);
	return okJson(c, {
		assetId: record.assetId, uploadUrl, key: objectKey, assetKey: objectKey,
		bucket: "uploads", status: record.status, expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
	}, 201);
});

assets.post("/:assetId/finalize", async (c) => {
	const record = await loadUploadRegistration(c.env, c.req.param("assetId"));
	if (!record) return Errors.notFound(c, "Upload registration not found");
	if (record.userId !== c.get("userId")) return Errors.forbidden(c, "You do not own this upload");
	try {
		const ready = await ensureUploadReady(c.env, record);
		return okJson(c, {
			assetId: ready.assetId,
			assetKey: ready.objectKey,
			key: ready.objectKey,
			bucket: "uploads",
			kind: ready.kind,
			contentType: ready.contentType,
			sizeBytes: ready.declaredSizeBytes,
			status: ready.status,
			readyAt: ready.readyAt,
		});
	} catch (error) {
		if (error instanceof Error && error.message === "upload_missing") return Errors.conflict(c, "Upload has not completed");
		if (error instanceof Error && error.message === "upload_size_mismatch") return Errors.validation(c, "Uploaded file size does not match its declaration");
		if (error instanceof Error && error.message === "upload_content_type_mismatch") return Errors.validation(c, "Uploaded content type does not match its declaration");
		throw error;
	}
});

assets.post("/:assetId/provider-url", async (c) => {
	const record = await loadUploadRegistration(c.env, c.req.param("assetId"));
	if (!record) return Errors.notFound(c, "Upload registration not found");
	if (record.userId !== c.get("userId")) return Errors.forbidden(c, "You do not own this upload");
	try {
		const ready = await ensureUploadReady(c.env, record);
		const token = await createProviderFetchToken(c.env, ready.assetId);
		return okJson(c, {
			assetId: ready.assetId,
			providerFetchUrl: providerFetchUrl(c.env, token),
			expiresInSeconds: PROVIDER_FETCH_TTL_SECONDS,
		});
	} catch (error) {
		if (error instanceof Error && error.message === "upload_missing") return Errors.conflict(c, "Upload has not completed");
		if (error instanceof Error && error.message.startsWith("upload_")) return Errors.validation(c, "Uploaded object does not match its declaration");
		throw error;
	}
});

assets.delete("/:assetId", async (c) => {
	const userId = c.get("userId");
	const record = await loadUploadRegistration(c.env, c.req.param("assetId"));
	if (!record) return Errors.notFound(c, "Upload registration not found");
	if (record.userId !== userId) return Errors.forbidden(c, "You do not own this upload");
	const inUse = await getDb(c.env.DB).select({ id: schema.userCharacterVersions.id })
		.from(schema.userCharacterVersions).where(and(
			eq(schema.userCharacterVersions.userId, userId),
			eq(schema.userCharacterVersions.sourceAssetKey, record.objectKey),
		)).get();
	if (inUse) return Errors.conflict(c, "Upload is already attached to a presenter");
	try {
		await c.env.UPLOADS_BUCKET.delete(record.objectKey);
		await getDb(c.env.DB).delete(schema.userUploadAssets).where(and(
			eq(schema.userUploadAssets.id, record.assetId),
			eq(schema.userUploadAssets.userId, userId),
		));
	} catch {
		return Errors.serviceUnavailable(c, "Private upload cleanup could not be completed");
	}
	return okJson(c, { assetId: record.assetId, deleted: true });
});

const DownloadUrlBody = z.object({
	bucket: z.enum(["assets", "renders", "uploads"]),
	key: z.string().min(1),
}).strict();

assets.post("/download-url", zValidator("json", DownloadUrlBody), async (c) => {
	const userId = c.get("userId");
	const { bucket, key } = c.req.valid("json");
	if (bucket === "uploads") {
		const record = await loadUploadByObjectKey(c.env, key);
		if (!record || record.userId !== userId) return Errors.forbidden(c, "You do not own this asset");
		try { await ensureUploadReady(c.env, record); }
		catch { return Errors.conflict(c, "Upload is not ready"); }
	} else if (!key.startsWith(`${userId}/`) && !key.startsWith(`users/${userId}/`)) {
		// Legacy key-based downloads remain available for old generated assets.
		return Errors.forbidden(c, "You do not own this asset");
	}
	const downloadUrl = await presignGet(c.env, bucket, key);
	return okJson(c, { downloadUrl, key, bucket, expiresInSeconds: 600 });
});

assets.get("/generation/:assetId", async (c) => {
	const db = getDb(c.env.DB);
	const row = await db.select({
		id: schema.generationAssets.id,
		jobId: schema.generationAssets.jobId,
		kind: schema.generationAssets.kind,
		storage: schema.generationAssets.storage,
		objectKey: schema.generationAssets.objectKey,
		contentType: schema.generationAssets.contentType,
		byteSize: schema.generationAssets.byteSize,
		checksum: schema.generationAssets.checksum,
		status: schema.generationAssets.status,
		createdAt: schema.generationAssets.createdAt,
		readyAt: schema.generationAssets.readyAt,
	}).from(schema.generationAssets)
		.innerJoin(schema.generationJobs, eq(schema.generationAssets.jobId, schema.generationJobs.id))
		.where(and(
			eq(schema.generationAssets.id, c.req.param("assetId")),
			eq(schema.generationJobs.userId, c.get("userId")),
		))
		.get();
	if (!row) return Errors.notFound(c, "Generation asset not found");
	if (row.status !== "ready") return Errors.conflict(c, "Generation asset is not ready");
	if (row.storage === "stream") {
		const video = await c.env.STREAM.video(row.objectKey).details();
		if (!streamVideoOwnedByGeneration(video, c.get("userId"), row.jobId)) {
			return Errors.forbidden(c, "Stream video ownership does not match this generation");
		}
		if (!video.readyToStream) return Errors.conflict(c, "Stream playback is not ready");
		const token = await c.env.STREAM.video(row.objectKey).generateToken();
		const playback = streamPlaybackUrls(c.env.STREAM_CUSTOMER_CODE, token);
		if (!playback) return Errors.serviceUnavailable(c, "Stream playback is not configured");
		const master = await db.select({
			objectKey: schema.generationAssets.objectKey,
			contentType: schema.generationAssets.contentType,
			byteSize: schema.generationAssets.byteSize,
			checksum: schema.generationAssets.checksum,
		}).from(schema.generationAssets).where(and(
			eq(schema.generationAssets.jobId, row.jobId),
			eq(schema.generationAssets.kind, "video_master"),
			eq(schema.generationAssets.storage, "r2"),
			eq(schema.generationAssets.status, "ready"),
		)).get();
		if (!master) return Errors.serviceUnavailable(c, "Generation master is unavailable");
		const downloadUrl = await presignGet(c.env, "assets", master.objectKey);
		return okJson(c, {
			assetId: row.id,
			jobId: row.jobId,
			kind: row.kind,
			contentType: row.contentType,
			status: row.status,
			createdAt: row.createdAt,
			readyAt: row.readyAt,
			playback,
			hlsUrl: playback.hls,
			dashUrl: playback.dash,
			downloadUrl,
			downloadExpiresInSeconds: 600,
			master: {
				contentType: master.contentType,
				sizeBytes: master.byteSize,
				checksum: master.checksum,
			},
		});
	}
	const bucket: PresignBucket | null = row.storage === "renders" ? "renders"
		: row.storage === "r2" || row.storage === "assets" ? "assets"
		: null;
	if (!bucket) return Errors.serviceUnavailable(c, "Generation asset storage is unavailable");
	const downloadUrl = await presignGet(c.env, bucket, row.objectKey);
	return okJson(c, {
		assetId: row.id,
		jobId: row.jobId,
		kind: row.kind,
		contentType: row.contentType,
		sizeBytes: row.byteSize,
		checksum: row.checksum,
		status: row.status,
		createdAt: row.createdAt,
		readyAt: row.readyAt,
		downloadUrl,
		expiresInSeconds: 600,
	});
});

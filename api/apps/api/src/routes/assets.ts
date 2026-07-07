import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { nanoid } from "nanoid";
import type { AppEnv } from "../env";
import { Errors, okJson } from "../lib/response";
import { presignGet, presignPut } from "../lib/r2";

export const assets = new Hono<AppEnv>();

const EXT_BY_CONTENT_TYPE: Record<string, string> = {
	"image/png": "png",
	"image/jpeg": "jpg",
	"image/webp": "webp",
	"audio/mpeg": "mp3",
	"audio/wav": "wav",
	"audio/mp4": "m4a",
};

const UploadUrlBody = z.object({
	kind: z.enum(["image", "audio"]),
	contentType: z.string().min(1),
});

// ---------- POST /upload-url ----------
// Presigned PUT into UPLOADS_BUCKET, scoped under `${userId}/...` so
// download-url ownership checks (and any future cleanup jobs) are simple.
assets.post("/upload-url", zValidator("json", UploadUrlBody), async (c) => {
	const userId = c.get("userId");
	const { kind, contentType } = c.req.valid("json");

	const ext = EXT_BY_CONTENT_TYPE[contentType];
	if (!ext) return Errors.badRequest(c, `Unsupported contentType: ${contentType}`);

	const key = `${userId}/${kind}/${nanoid()}.${ext}`;
	const uploadUrl = await presignPut(c.env, "uploads", key, contentType);

	return okJson(c, { uploadUrl, key, bucket: "uploads", expiresInSeconds: 600 });
});

const DownloadUrlBody = z.object({
	bucket: z.enum(["assets", "renders"]),
	key: z.string().min(1),
});

// ---------- POST /download-url ----------
assets.post("/download-url", zValidator("json", DownloadUrlBody), async (c) => {
	const userId = c.get("userId");
	const { bucket, key } = c.req.valid("json");

	if (!key.startsWith(`${userId}/`)) {
		return Errors.forbidden(c, "You do not own this asset");
	}

	const downloadUrl = await presignGet(c.env, bucket, key);
	return okJson(c, { downloadUrl, key, bucket, expiresInSeconds: 600 });
});

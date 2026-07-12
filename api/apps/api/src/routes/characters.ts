import { zValidator } from "@hono/zod-validator";
import { and, desc, eq, gt, inArray, isNull, ne, or } from "drizzle-orm";
import { Hono } from "hono";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getDb, schema } from "@app/db";
import type { AppEnv } from "../env";
import { Errors, okJson } from "../lib/response";
import { presignGet } from "../lib/r2";

export const characters = new Hono<AppEnv>();

characters.get("/stock", async (c) => {
	const now = Date.now();
	const rows = await getDb(c.env.DB).select().from(schema.stockCharacters).where(and(
		eq(schema.stockCharacters.isActive, true),
		eq(schema.stockCharacters.consentStatus, "verified"),
		or(isNull(schema.stockCharacters.licenseExpiresAt), gt(schema.stockCharacters.licenseExpiresAt, now)),
	)).orderBy(desc(schema.stockCharacters.createdAt));
	return okJson(c, await Promise.all(rows.map(async (row) => ({
		id: row.id, slug: row.slug, name: row.name,
		previewAssetKey: row.previewAssetKey,
		previewUrl: await presignGet(c.env, "assets", row.previewAssetKey),
		previewExpiresInSeconds: 600,
		tags: Array.isArray(row.tags) ? row.tags : [],
		licenseExpiresAt: row.licenseExpiresAt,
	}))));
});

characters.get("/mine", async (c) => {
	const userId = c.get("userId");
	const db = getDb(c.env.DB);
	const rows = await db.select().from(schema.userCharacters)
		.where(and(eq(schema.userCharacters.userId, userId), ne(schema.userCharacters.status, "archived")))
		.orderBy(desc(schema.userCharacters.updatedAt));
	const versions = await db.select().from(schema.userCharacterVersions)
		.where(eq(schema.userCharacterVersions.userId, userId));
	const byId = new Map(versions.map((version) => [version.id, version]));
	return okJson(c, await Promise.all(rows.map(async (row) => {
		const version = row.currentVersionId ? byId.get(row.currentVersionId) : undefined;
		const previewKey = version?.previewAssetKey ?? version?.sourceAssetKey ?? null;
		return {
			id: row.id, name: row.name, status: row.status,
			currentVersionId: row.currentVersionId,
			versionStatus: version?.status ?? null,
			previewAssetKey: version?.previewAssetKey ?? null,
			previewUrl: previewKey ? await presignGet(c.env, "uploads", previewKey) : null,
			previewExpiresInSeconds: previewKey ? 600 : null,
			moderationResult: version?.moderationResult ?? null,
			createdAt: row.createdAt, updatedAt: row.updatedAt, archivedAt: row.archivedAt,
		};
	})));
});

const CreateCharacterBody = z.object({
	name: z.string().trim().min(1).max(100),
	assetId: z.string().min(1).max(200),
	consent: z.object({
		confirmed: z.literal(true),
		statement: z.string().trim().min(10).max(500),
	}).strict(),
}).strict();

async function fingerprint(value: unknown): Promise<string> {
	const bytes = new TextEncoder().encode(JSON.stringify(value));
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function replayCharacter(c: Parameters<typeof okJson>[0], mutation: typeof schema.characterMutations.$inferSelect, requestFingerprint: string) {
	if (mutation.requestFingerprint !== requestFingerprint) return Errors.conflict(c, "Idempotency key was already used for a different presenter request");
	c.header("x-idempotent-replay", "true");
	return okJson(c, mutation.responseSnapshot, 201);
}

characters.post("/mine", zValidator("json", CreateCharacterBody), async (c) => {
	const userId = c.get("userId");
	const body = c.req.valid("json");
	const idempotencyKey = c.req.header("Idempotency-Key");
	if (!idempotencyKey || !/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) return Errors.validation(c, "A valid Idempotency-Key header is required");
	const requestFingerprint = await fingerprint({ name: body.name, assetId: body.assetId, consent: body.consent });
	const db = getDb(c.env.DB);
	const existing = await db.select().from(schema.characterMutations).where(and(eq(schema.characterMutations.userId, userId), eq(schema.characterMutations.idempotencyKey, idempotencyKey))).get();
	if (existing) return replayCharacter(c, existing, requestFingerprint);
	const asset = await db.select().from(schema.userUploadAssets).where(and(
		eq(schema.userUploadAssets.id, body.assetId),
		eq(schema.userUploadAssets.userId, userId),
		eq(schema.userUploadAssets.kind, "image"),
		eq(schema.userUploadAssets.status, "ready"),
		eq(schema.userUploadAssets.purpose, "character_source"),
	)).get();
	if (!asset) return Errors.validation(c, "Choose a finalized image upload you own");
	const attached = await db.select({ id: schema.userCharacterVersions.id }).from(schema.userCharacterVersions).where(eq(schema.userCharacterVersions.sourceAssetKey, asset.objectKey)).get();
	if (attached) return Errors.conflict(c, "This source image is already attached to a presenter");

	const characterId = nanoid();
	const versionId = nanoid();
	const mutationId = nanoid();
	const now = Date.now();
	const consentRecord = {
		confirmed: true,
		statement: body.consent.statement,
		confirmedAt: now,
		sourceAssetId: asset.id,
	};
	const responseSnapshot = {
		id: characterId, name: body.name, status: "pending_review",
		currentVersionId: versionId, versionStatus: "pending_review",
		previewAssetKey: null, createdAt: now, updatedAt: now, archivedAt: null,
	};
	try {
		await c.env.DB.batch([
			c.env.DB.prepare(`INSERT INTO user_characters (id,user_id,name,status,current_version_id,created_at,updated_at,archived_at) VALUES (?,?,?,'pending_review',?,?,?,NULL)`).bind(characterId, userId, body.name, versionId, now, now),
			c.env.DB.prepare(`INSERT INTO user_character_versions (id,user_character_id,user_id,version,status,source_asset_key,preview_asset_key,consent_record,provider_refs,moderation_result,created_at,ready_at) VALUES (?,?,?,1,'pending_review',?,NULL,?,NULL,NULL,?,NULL)`).bind(versionId, characterId, userId, asset.objectKey, JSON.stringify(consentRecord), now),
			c.env.DB.prepare(`INSERT INTO character_mutations (id,user_id,idempotency_key,request_fingerprint,response_snapshot,asset_id,character_id,created_at) VALUES (?,?,?,?,?,?,?,?)`).bind(mutationId, userId, idempotencyKey, requestFingerprint, JSON.stringify(responseSnapshot), asset.id, characterId, now),
		]);
	} catch (error) {
		const raced = await db.select().from(schema.characterMutations).where(and(eq(schema.characterMutations.userId, userId), eq(schema.characterMutations.idempotencyKey, idempotencyKey))).get();
		if (raced) return replayCharacter(c, raced, requestFingerprint);
		const reused = await db.select({ id: schema.characterMutations.id }).from(schema.characterMutations).where(eq(schema.characterMutations.assetId, asset.id)).get();
		if (reused) return Errors.conflict(c, "This source image is already attached to a presenter");
		throw error;
	}
	return okJson(c, responseSnapshot, 201);
});

characters.patch("/mine/:id/archive", async (c) => {
	const userId = c.get("userId");
	const id = c.req.param("id");
	const db = getDb(c.env.DB);
	const existing = await db.select({ id: schema.userCharacters.id }).from(schema.userCharacters)
		.where(and(eq(schema.userCharacters.id, id), eq(schema.userCharacters.userId, userId))).get();
	if (!existing) return Errors.notFound(c, "Character not found");
	const now = Date.now();
	await db.update(schema.userCharacters).set({ status: "archived", archivedAt: now, updatedAt: now })
		.where(and(eq(schema.userCharacters.id, id), eq(schema.userCharacters.userId, userId)));
	return okJson(c, { id, status: "archived", archivedAt: now });
});

characters.delete("/mine/:id", async (c) => {
	const userId = c.get("userId");
	const id = c.req.param("id");
	const db = getDb(c.env.DB);
	const existing = await db.select({ id: schema.userCharacters.id }).from(schema.userCharacters)
		.where(and(eq(schema.userCharacters.id, id), eq(schema.userCharacters.userId, userId))).get();
	if (!existing) return Errors.notFound(c, "Character not found");
	const versions = await db.select({ id: schema.userCharacterVersions.id, sourceAssetKey: schema.userCharacterVersions.sourceAssetKey })
		.from(schema.userCharacterVersions).where(and(
			eq(schema.userCharacterVersions.userCharacterId, id),
			eq(schema.userCharacterVersions.userId, userId),
		));
	if (versions.length > 0) {
		const used = await db.select({ id: schema.generationJobs.id }).from(schema.generationJobs)
			.where(and(eq(schema.generationJobs.userId, userId), inArray(schema.generationJobs.userCharacterVersionId, versions.map((version) => version.id)))).get();
		if (used) return Errors.conflict(c, "This character is used by existing generations and cannot be deleted; archive it instead");
	}
	try {
		// Delete biometric source objects first. R2 deletion is idempotent, so a
		// retry safely completes D1 cleanup if a later batch transiently fails.
		await Promise.all(versions.map((version) => c.env.UPLOADS_BUCKET.delete(version.sourceAssetKey)));
		await c.env.DB.batch([
			c.env.DB.prepare("DELETE FROM character_mutations WHERE user_id=? AND character_id=?").bind(userId, id),
			c.env.DB.prepare("DELETE FROM user_character_versions WHERE user_character_id=? AND user_id=?").bind(id, userId),
			c.env.DB.prepare("DELETE FROM user_characters WHERE id=? AND user_id=?").bind(id, userId),
			...versions.map((version) => c.env.DB.prepare("DELETE FROM user_upload_assets WHERE user_id=? AND object_key=?").bind(userId, version.sourceAssetKey)),
		]);
	} catch {
		return Errors.serviceUnavailable(c, "Presenter cleanup could not be completed. Try again safely.");
	}
	return okJson(c, { id });
});

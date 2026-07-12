import { Hono } from "hono";
import { z } from "zod";
import { nanoid } from "nanoid";
import { and, count, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@app/db";
import { err, ok } from "@app/shared";
import type { AppBindings } from "../types.js";
import { isResponse, parseBody, requirePermission } from "../lib/http.js";
import { writeAudit } from "../lib/audit.js";
import { sanitizeAuditValue } from "../lib/audit-sanitize.js";

const app = new Hono<AppBindings>();
const characterSchema = z.object({ slug: z.string().trim().min(2).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/), name: z.string().trim().min(1).max(120), previewAssetKey: z.string().trim().min(1).max(500), tags: z.array(z.string().trim().min(1).max(40)).max(30).default([]), consentStatus: z.enum(["verified", "pending", "revoked"]), licenseExpiresAt: z.number().int().positive().nullable().optional(), isActive: z.boolean().default(true), reason: z.string().trim().min(3).max(500) }).strict();
const updateSchema = characterSchema.omit({ slug: true }).partial().required({ reason: true }).strict();
const reviewQuerySchema = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25) });
const decisionSchema = z.object({ decision: z.enum(["approve", "reject"]), reason: z.string().trim().min(8).max(500) }).strict();

app.get("/review", async (c) => {
	const denied = requirePermission(c, "characters.moderate"); if (denied) return denied;
	const parsed = reviewQuerySchema.safeParse(c.req.query());
	if (!parsed.success) return c.json(err("VALIDATION_ERROR", "Invalid review queue query"), 400);
	const { page, pageSize } = parsed.data; const db = getDb(c.env.DB);
	const pending = eq(schema.userCharacterVersions.status, "pending_review");
	const items = await db.select({
		versionId: schema.userCharacterVersions.id, characterId: schema.userCharacters.id,
		name: schema.userCharacters.name, userId: schema.userCharacterVersions.userId,
		userEmail: schema.user.email, version: schema.userCharacterVersions.version,
		status: schema.userCharacterVersions.status, consentRecord: schema.userCharacterVersions.consentRecord,
		createdAt: schema.userCharacterVersions.createdAt,
	}).from(schema.userCharacterVersions)
		.innerJoin(schema.userCharacters, eq(schema.userCharacterVersions.userCharacterId, schema.userCharacters.id))
		.leftJoin(schema.user, eq(schema.userCharacterVersions.userId, schema.user.id))
		.where(pending).orderBy(schema.userCharacterVersions.createdAt).limit(pageSize).offset((page - 1) * pageSize);
	const [total] = await db.select({ value: count() }).from(schema.userCharacterVersions).where(pending);
	return c.json(ok({ items, page, pageSize, total: total?.value ?? 0 }));
});

app.get("/review/:versionId/source", async (c) => {
	const denied = requirePermission(c, "characters.moderate"); if (denied) return denied;
	const [version] = await getDb(c.env.DB).select({ sourceAssetKey: schema.userCharacterVersions.sourceAssetKey })
		.from(schema.userCharacterVersions).where(and(eq(schema.userCharacterVersions.id, c.req.param("versionId")), eq(schema.userCharacterVersions.status, "pending_review"))).limit(1);
	if (!version) return c.json(err("NOT_FOUND", "Pending character version not found"), 404);
	const object = await c.env.UPLOADS_BUCKET.get(version.sourceAssetKey);
	if (!object) return c.json(err("SOURCE_NOT_FOUND", "Private source object is unavailable"), 404);
	const contentType = object.httpMetadata?.contentType ?? "application/octet-stream";
	if (!contentType.startsWith("image/")) return c.json(err("INVALID_SOURCE", "Character source is not an image"), 409);
	return new Response(object.body, { headers: {
		"content-type": contentType, "content-length": String(object.size),
		"cache-control": "private, no-store, max-age=0", "content-disposition": "inline",
		"x-content-type-options": "nosniff", "x-robots-tag": "noindex, nofollow",
	} });
});

app.post("/review/:versionId/decision", async (c) => {
	const denied = requirePermission(c, "characters.moderate"); if (denied) return denied;
	const body = await parseBody(c, decisionSchema); if (isResponse(body)) return body;
	const db = getDb(c.env.DB); const versionId = c.req.param("versionId");
	const [before] = await db.select({ versionId: schema.userCharacterVersions.id, characterId: schema.userCharacterVersions.userCharacterId, status: schema.userCharacterVersions.status, userId: schema.userCharacterVersions.userId, sourceAssetKey: schema.userCharacterVersions.sourceAssetKey, consentRecord: schema.userCharacterVersions.consentRecord })
		.from(schema.userCharacterVersions).where(eq(schema.userCharacterVersions.id, versionId)).limit(1);
	if (!before) return c.json(err("NOT_FOUND", "Character version not found"), 404);
	if (before.status !== "pending_review") return c.json(err("REVIEW_ALREADY_DECIDED", "This review item is no longer pending"), 409);
	if (body.decision === "approve") {
		const consent = before.consentRecord as { confirmed?: boolean; sourceAssetId?: string } | null;
		if (!consent?.confirmed || !consent.sourceAssetId) return c.json(err("CONSENT_REQUIRED", "Verified explicit consent is required before approval"), 409);
		const [source] = await db.select({ id: schema.userUploadAssets.id }).from(schema.userUploadAssets).where(and(
			eq(schema.userUploadAssets.id, consent.sourceAssetId),
			eq(schema.userUploadAssets.userId, before.userId),
			eq(schema.userUploadAssets.objectKey, before.sourceAssetKey),
			eq(schema.userUploadAssets.kind, "image"),
			eq(schema.userUploadAssets.status, "ready"),
		)).limit(1);
		if (!source) return c.json(err("SOURCE_NOT_READY", "Finalized tenant-owned source image is required before approval"), 409);
	}
	const now = Date.now(); const nextStatus = body.decision === "approve" ? "ready" : "rejected";
	const evidence = JSON.stringify({ decision: body.decision, reason: body.reason, reviewedAt: now, reviewerUserId: c.get("adminUser").id, requestId: c.get("requestId") });
	const auditId = nanoid();
	const auditBefore = JSON.stringify(sanitizeAuditValue(before));
	const auditAfter = JSON.stringify(sanitizeAuditValue({ status: nextStatus, moderationEvidence: JSON.parse(evidence) }));
	// Updating the parent first with a pending-version EXISTS guard makes the batch
	// safe when two operators decide the same item concurrently.
	const results = await c.env.DB.batch([
		c.env.DB.prepare("UPDATE user_characters SET status = ?, updated_at = ? WHERE id = ? AND current_version_id = ? AND EXISTS (SELECT 1 FROM user_character_versions WHERE id = ? AND status = 'pending_review')").bind(nextStatus, now, before.characterId, versionId, versionId),
		c.env.DB.prepare("UPDATE user_character_versions SET status = ?, moderation_result = ?, ready_at = ? WHERE id = ? AND status = 'pending_review' AND EXISTS (SELECT 1 FROM user_characters WHERE id = ? AND current_version_id = ? AND status = ?)").bind(nextStatus, evidence, body.decision === "approve" ? now : null, versionId, before.characterId, versionId, nextStatus),
		c.env.DB.prepare("INSERT INTO admin_audit_events (id,actor_user_id,request_id,action,target_type,target_id,reason,before_summary,after_summary,created_at) SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM user_characters c JOIN user_character_versions v ON v.user_character_id=c.id WHERE c.id=? AND c.current_version_id=? AND c.status=? AND v.id=? AND v.status=?)").bind(auditId, c.get("adminUser").id, c.get("requestId"), `user_character.${body.decision}`, "user_character_version", versionId, body.reason, auditBefore, auditAfter, now, before.characterId, versionId, nextStatus, versionId, nextStatus),
	]);
	if ((results[0]?.meta.changes ?? 0) !== 1 || (results[1]?.meta.changes ?? 0) !== 1 || (results[2]?.meta.changes ?? 0) !== 1) return c.json(err("REVIEW_ALREADY_DECIDED", "This review item changed before the decision could commit"), 409);
	const [committed] = await db.select({ parentStatus: schema.userCharacters.status, versionStatus: schema.userCharacterVersions.status })
		.from(schema.userCharacterVersions).innerJoin(schema.userCharacters, eq(schema.userCharacterVersions.userCharacterId, schema.userCharacters.id))
		.where(and(eq(schema.userCharacterVersions.id, versionId), eq(schema.userCharacters.currentVersionId, versionId))).limit(1);
	if (!committed || committed.parentStatus !== nextStatus || committed.versionStatus !== nextStatus) return c.json(err("REVIEW_STATE_MISMATCH", "Review state could not be verified"), 409);
	return c.json(ok({ versionId, characterId: before.characterId, status: nextStatus }));
});

app.get("/", async (c) => { const denied = requirePermission(c, "characters.read"); if (denied) return denied; return c.json(ok(await getDb(c.env.DB).select().from(schema.stockCharacters).orderBy(desc(schema.stockCharacters.createdAt)))); });
app.post("/", async (c) => { const denied = requirePermission(c, "characters.write"); if (denied) return denied; const body = await parseBody(c, characterSchema); if (isResponse(body)) return body; if (body.isActive && body.consentStatus !== "verified") return c.json(err("CONSENT_REQUIRED", "Only verified characters can be active"), 409); const { reason, ...values } = body; const id = nanoid(); await getDb(c.env.DB).insert(schema.stockCharacters).values({ id, ...values }); await c.env.KV.delete("catalog:version"); await writeAudit(c, { action: "stock_character.create", targetType: "stock_character", targetId: id, reason, after: values }); return c.json(ok({ id }), 201); });
app.put("/:id", async (c) => { const denied = requirePermission(c, "characters.write"); if (denied) return denied; const body = await parseBody(c, updateSchema); if (isResponse(body)) return body; const db = getDb(c.env.DB); const id = c.req.param("id"); const [before] = await db.select().from(schema.stockCharacters).where(eq(schema.stockCharacters.id, id)).limit(1); if (!before) return c.json(err("NOT_FOUND", "Character not found"), 404); const { reason, ...values } = body; const consent = values.consentStatus ?? before.consentStatus; const active = values.isActive ?? before.isActive; if (active && consent !== "verified") return c.json(err("CONSENT_REQUIRED", "Only verified characters can be active"), 409); await db.update(schema.stockCharacters).set({ ...values, updatedAt: Date.now() }).where(eq(schema.stockCharacters.id, id)); await c.env.KV.delete("catalog:version"); await writeAudit(c, { action: "stock_character.update", targetType: "stock_character", targetId: id, reason, before, after: values }); return c.json(ok({ id })); });
export default app;

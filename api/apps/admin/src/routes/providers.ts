import { Hono } from "hono";
import { z } from "zod";
import { nanoid } from "nanoid";
import { and, asc, desc, eq, max } from "drizzle-orm";
import { getDb, schema } from "@app/db";
import { err, ok } from "@app/shared";
import type { AppBindings } from "../types.js";
import { isResponse, parseBody, requirePermission } from "../lib/http.js";
import { writeAudit } from "../lib/audit.js";

const app = new Hono<AppBindings>();
const key = z.string().trim().min(2).max(120).regex(/^[a-z0-9][a-z0-9_./-]*$/);
const reason = z.string().trim().min(3).max(500);
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
const jsonValue: z.ZodType<JsonValue> = z.lazy(() => z.union([z.string().max(10_000), z.number().finite(), z.boolean(), z.null(), z.array(jsonValue).max(100), z.record(z.string().min(1).max(80), jsonValue)]));
const boundedRecord = z.record(z.string().min(1).max(80), jsonValue).superRefine((value, ctx) => {
	const within = (item: JsonValue, depth = 0): boolean => depth <= 6 && (Array.isArray(item) ? item.every((child) => within(child, depth + 1)) : item && typeof item === "object" ? Object.keys(item).length <= 100 && Object.values(item).every((child) => within(child, depth + 1)) : true);
	if (!within(value)) ctx.addIssue({ code: "custom", message: "JSON must be at most 6 levels deep and 100 keys per object" });
	if (JSON.stringify(value).length > 50_000) ctx.addIssue({ code: "custom", message: "JSON must be 50 KB or smaller" });
});
const providerSchema = z.object({ providerKey: key, name: z.string().trim().min(1).max(120), kind: z.enum(["replicate", "workers_ai", "custom"]), publicConfig: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}), isActive: z.boolean().default(true), reason }).strict();
const modelSchema = z.object({ modelKey: key, name: z.string().trim().min(1).max(120), modality: z.enum(["video", "image", "audio", "text", "multimodal"]), isActive: z.boolean().default(true), reason }).strict();
const versionSchema = z.object({ providerVersionRef: z.string().trim().min(1).max(300), capabilities: boundedRecord, costConfig: boundedRecord.nullable().default(null), reason }).strict();
const statusSchema = z.object({ isActive: z.boolean(), reason }).strict();
const publishSchema = z.object({ reason }).strict();

app.get("/", async (c) => {
	const denied = requirePermission(c, "providers.read"); if (denied) return denied;
	const db = getDb(c.env.DB);
	const [providers, models, versions] = await Promise.all([
		db.select().from(schema.providers).orderBy(asc(schema.providers.name)),
		db.select().from(schema.providerModels).orderBy(asc(schema.providerModels.name)),
		db.select().from(schema.providerModelVersions).orderBy(desc(schema.providerModelVersions.createdAt)),
	]);
	return c.json(ok({ providers, models, versions, pinnedTestModel: { providerKey: "replicate", modelKey: "prunaai/p-video", label: "Pinned test default", credentials: "Cloudflare secret only" } }));
});

app.post("/", async (c) => {
	const denied = requirePermission(c, "providers.write"); if (denied) return denied;
	const body = await parseBody(c, providerSchema); if (isResponse(body)) return body;
	const { reason: why, ...values } = body; const id = nanoid(); await getDb(c.env.DB).insert(schema.providers).values({ id, ...values });
	await writeAudit(c, { action: "provider.create", targetType: "provider", targetId: id, reason: why, after: values });
	return c.json(ok({ id }), 201);
});

app.put("/:id/status", async (c) => {
	const denied = requirePermission(c, "providers.write"); if (denied) return denied;
	const body = await parseBody(c, statusSchema); if (isResponse(body)) return body;
	const db = getDb(c.env.DB); const id = c.req.param("id"); const [before] = await db.select().from(schema.providers).where(eq(schema.providers.id, id)).limit(1);
	if (!before) return c.json(err("NOT_FOUND", "Provider not found"), 404);
	await db.update(schema.providers).set({ isActive: body.isActive, updatedAt: Date.now() }).where(eq(schema.providers.id, id));
	await writeAudit(c, { action: "provider.status", targetType: "provider", targetId: id, reason: body.reason, before, after: { isActive: body.isActive } });
	return c.json(ok({ id, isActive: body.isActive }));
});

app.post("/:providerId/models", async (c) => {
	const denied = requirePermission(c, "providers.write"); if (denied) return denied;
	const body = await parseBody(c, modelSchema); if (isResponse(body)) return body;
	const db = getDb(c.env.DB); const providerId = c.req.param("providerId");
	const [provider] = await db.select({ id: schema.providers.id }).from(schema.providers).where(eq(schema.providers.id, providerId)).limit(1);
	if (!provider) return c.json(err("NOT_FOUND", "Provider not found"), 404);
	const { reason: why, ...values } = body; const id = nanoid(); await db.insert(schema.providerModels).values({ id, providerId, ...values });
	await writeAudit(c, { action: "provider_model.create", targetType: "provider_model", targetId: id, reason: why, after: { providerId, ...values } });
	return c.json(ok({ id }), 201);
});

app.put("/models/:id/status", async (c) => {
	const denied = requirePermission(c, "providers.write"); if (denied) return denied;
	const body = await parseBody(c, statusSchema); if (isResponse(body)) return body;
	const db = getDb(c.env.DB); const id = c.req.param("id"); const [before] = await db.select().from(schema.providerModels).where(eq(schema.providerModels.id, id)).limit(1);
	if (!before) return c.json(err("NOT_FOUND", "Provider model not found"), 404);
	await db.update(schema.providerModels).set({ isActive: body.isActive, updatedAt: Date.now() }).where(eq(schema.providerModels.id, id));
	await c.env.KV.delete("catalog:version");
	await writeAudit(c, { action: "provider_model.status", targetType: "provider_model", targetId: id, reason: body.reason, before, after: { isActive: body.isActive } });
	return c.json(ok({ id, isActive: body.isActive }));
});

app.post("/models/:modelId/versions", async (c) => {
	const denied = requirePermission(c, "providers.write"); if (denied) return denied;
	const body = await parseBody(c, versionSchema); if (isResponse(body)) return body;
	const db = getDb(c.env.DB); const providerModelId = c.req.param("modelId");
	const [model] = await db.select({ id: schema.providerModels.id }).from(schema.providerModels).where(eq(schema.providerModels.id, providerModelId)).limit(1);
	if (!model) return c.json(err("NOT_FOUND", "Provider model not found"), 404);
	const [latest] = await db.select({ value: max(schema.providerModelVersions.version) }).from(schema.providerModelVersions).where(eq(schema.providerModelVersions.providerModelId, providerModelId));
	const { reason: why, ...values } = body; const id = nanoid(); const version = (latest?.value ?? 0) + 1;
	await db.insert(schema.providerModelVersions).values({ id, providerModelId, version, status: "draft", ...values });
	await writeAudit(c, { action: "provider_model_version.create", targetType: "provider_model_version", targetId: id, reason: why, after: { providerModelId, version, ...values } });
	return c.json(ok({ id, version }), 201);
});

app.post("/versions/:id/publish", async (c) => {
	const denied = requirePermission(c, "providers.publish"); if (denied) return denied;
	const body = await parseBody(c, publishSchema); if (isResponse(body)) return body;
	const db = getDb(c.env.DB); const id = c.req.param("id"); const [row] = await db.select().from(schema.providerModelVersions).where(eq(schema.providerModelVersions.id, id)).limit(1);
	if (!row) return c.json(err("NOT_FOUND", "Model version not found"), 404);
	if (row.status !== "draft") return c.json(err("INVALID_STATUS", "Only draft model versions can be published"), 409);
	await db.update(schema.providerModelVersions).set({ status: "published", publishedAt: Date.now() }).where(and(eq(schema.providerModelVersions.id, id), eq(schema.providerModelVersions.status, "draft")));
	await c.env.KV.delete("catalog:version"); await writeAudit(c, { action: "provider_model_version.publish", targetType: "provider_model_version", targetId: id, reason: body.reason, before: row, after: { status: "published" } });
	return c.json(ok({ id, status: "published" }));
});

export default app;

import { Hono } from "hono";
import { z } from "zod";
import { nanoid } from "nanoid";
import { and, asc, desc, eq, max } from "drizzle-orm";
import { getDb, schema } from "@app/db";
import { NormalizedPVideoInput, TemplateInputSchema, err, ok } from "@app/shared";
import type { AppBindings } from "../types.js";
import { isResponse, parseBody, requirePermission } from "../lib/http.js";
import { writeAudit } from "../lib/audit.js";
import { publishCommitSucceeded, validatePublishState } from "../lib/publish-rules.js";
import { validatePVideoPublishState } from "../lib/p-video-rules.js";

const app = new Hono<AppBindings>();
const reason = z.string().trim().min(3).max(500);
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
const jsonValue: z.ZodType<JsonValue> = z.lazy(() => z.union([z.string().max(10_000), z.number().finite(), z.boolean(), z.null(), z.array(jsonValue).max(100), z.record(z.string().min(1).max(80), jsonValue)]));
function jsonShapeWithinBounds(value: JsonValue, depth = 0): boolean {
	if (depth > 6) return false;
	if (Array.isArray(value)) return value.every((item) => jsonShapeWithinBounds(item, depth + 1));
	if (value && typeof value === "object") return Object.keys(value).length <= 100 && Object.values(value).every((item) => jsonShapeWithinBounds(item, depth + 1));
	return true;
}
const safeRecord = z.record(z.string().min(1).max(80), jsonValue).superRefine((value, ctx) => {
	if (!jsonShapeWithinBounds(value)) ctx.addIssue({ code: "custom", message: "JSON must be at most 6 levels deep and 100 keys per object" });
	if (JSON.stringify(value).length > 50_000) ctx.addIssue({ code: "custom", message: "JSON must be 50 KB or smaller" });
}).default({});
const bindingSchema = z.object({ providerModelVersionId: z.string().trim().min(1).max(128), priority: z.number().int().min(0).max(1000).default(0), rolloutPercent: z.number().int().min(0).max(100).default(100), inputMapping: safeRecord, isActive: z.boolean().default(true) }).strict();
const versionFields = z.object({ displayName: z.string().trim().min(1).max(160), description: z.string().trim().max(1000).nullable().optional(), previewAssetKey: z.string().trim().max(500).nullable().optional(), pipelineType: z.enum(["p_video", "provider", "composite", "render"]), capabilities: safeRecord, pricingVersionId: z.string().trim().min(1).max(128), configSnapshot: safeRecord, inputSchema: TemplateInputSchema, providerBindings: z.array(bindingSchema).min(1).max(10) }).strict();
const createSchema = versionFields.extend({ slug: z.string().trim().min(2).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/), name: z.string().trim().min(1).max(160), categoryIds: z.array(z.string().trim().min(1).max(128)).max(20).default([]), reason }).strict();
const createVersionSchema = versionFields.extend({ reason }).strict();
const reasonSchema = z.object({ reason }).strict();

async function cacheBust(kv: KVNamespace): Promise<void> {
	await kv.put("catalog:version", `${Date.now()}:${crypto.randomUUID()}`);
	await kv.delete("templates:v1");
}

function definitionValues(versionId: string, inputSchema: z.output<typeof TemplateInputSchema>) {
	return inputSchema.fields.map((field) => {
		const { id: _contractId, key, type, label, helpText, required, order, visibility } = field;
		const options = field.type === "select" ? field.options : null;
		const constraints = field.type === "select"
			? { multiple: field.multiple }
			: Object.fromEntries(Object.entries(field).filter(([name]) => !["id", "key", "type", "label", "helpText", "required", "order", "visibility"].includes(name)));
		return { id: nanoid(), templateVersionId: versionId, fieldKey: key, fieldType: type, label, helpText: helpText ?? null, isRequired: required, sortOrder: order, constraints, options, visibilityRule: visibility ?? null };
	});
}

async function createDraftVersion(c: Parameters<typeof writeAudit>[0], templateId: string, version: number, body: z.output<typeof versionFields>, createdBy: string): Promise<string> {
	const db = getDb(c.env.DB); const id = nanoid();
	await db.insert(schema.templateVersions).values({ id, templateId, version, status: "draft", displayName: body.displayName, description: body.description ?? null, previewAssetKey: body.previewAssetKey ?? null, pipelineType: body.pipelineType, inputSchemaVersion: body.inputSchema.version, capabilities: body.capabilities, pricingVersionId: body.pricingVersionId, configSnapshot: { ...body.configSnapshot, inputSchema: body.inputSchema }, createdBy });
	const definitions = definitionValues(id, body.inputSchema); if (definitions.length) await db.insert(schema.templateInputDefinitions).values(definitions);
	for (const binding of body.providerBindings) await db.insert(schema.templatePipelineBindings).values({ id: nanoid(), templateVersionId: id, ...binding });
	return id;
}

app.get("/", async (c) => {
	const denied = requirePermission(c, "catalog.read"); if (denied) return denied;
	const db = getDb(c.env.DB); const [templates, versions] = await Promise.all([db.select().from(schema.templates).orderBy(desc(schema.templates.updatedAt)), db.select().from(schema.templateVersions).orderBy(desc(schema.templateVersions.createdAt))]);
	return c.json(ok(templates.map((template) => ({ ...template, versions: versions.filter((version) => version.templateId === template.id) }))));
});

app.get("/versions/:versionId", async (c) => {
	const denied = requirePermission(c, "catalog.read"); if (denied) return denied;
	const db = getDb(c.env.DB); const versionId = c.req.param("versionId"); const [version] = await db.select().from(schema.templateVersions).where(eq(schema.templateVersions.id, versionId)).limit(1);
	if (!version) return c.json(err("NOT_FOUND", "Template version not found"), 404);
	const [inputs, bindings] = await Promise.all([db.select().from(schema.templateInputDefinitions).where(eq(schema.templateInputDefinitions.templateVersionId, versionId)).orderBy(asc(schema.templateInputDefinitions.sortOrder)), db.select().from(schema.templatePipelineBindings).where(eq(schema.templatePipelineBindings.templateVersionId, versionId)).orderBy(asc(schema.templatePipelineBindings.priority))]);
	return c.json(ok({ version, inputs, bindings }));
});

app.get("/:id", async (c) => {
	const denied = requirePermission(c, "catalog.read"); if (denied) return denied;
	const db = getDb(c.env.DB); const id = c.req.param("id"); const [template] = await db.select().from(schema.templates).where(eq(schema.templates.id, id)).limit(1);
	if (!template) return c.json(err("NOT_FOUND", "Template not found"), 404);
	return c.json(ok({ template, versions: await db.select().from(schema.templateVersions).where(eq(schema.templateVersions.templateId, id)).orderBy(desc(schema.templateVersions.version)), categories: await db.select().from(schema.templateCategoryLinks).where(eq(schema.templateCategoryLinks.templateId, id)) }));
});

app.post("/", async (c) => {
	const denied = requirePermission(c, "catalog.write"); if (denied) return denied;
	const body = await parseBody(c, createSchema); if (isResponse(body)) return body;
	const db = getDb(c.env.DB); const templateId = nanoid();
	await db.insert(schema.templates).values({ id: templateId, slug: body.slug, vertical: "versioned", name: body.name, scriptPromptPreset: "versioned", imageStylePreset: "versioned", isActive: false, lifecycleStatus: "draft" });
	const versionId = await createDraftVersion(c, templateId, 1, body, c.get("adminUser").id);
	for (const categoryId of body.categoryIds) await db.insert(schema.templateCategoryLinks).values({ templateId, categoryId }).onConflictDoNothing();
	await writeAudit(c, { action: "template.create_draft", targetType: "template", targetId: templateId, reason: body.reason, after: { slug: body.slug, name: body.name, versionId } });
	return c.json(ok({ templateId, versionId }), 201);
});

app.post("/:id/versions", async (c) => {
	const denied = requirePermission(c, "catalog.write"); if (denied) return denied;
	const body = await parseBody(c, createVersionSchema); if (isResponse(body)) return body;
	const db = getDb(c.env.DB); const templateId = c.req.param("id"); const [template] = await db.select().from(schema.templates).where(eq(schema.templates.id, templateId)).limit(1);
	if (!template) return c.json(err("NOT_FOUND", "Template not found"), 404); if (template.lifecycleStatus === "archived") return c.json(err("INVALID_STATUS", "Archived templates cannot receive versions"), 409);
	const [latest] = await db.select({ value: max(schema.templateVersions.version) }).from(schema.templateVersions).where(eq(schema.templateVersions.templateId, templateId));
	const version = (latest?.value ?? 0) + 1; const versionId = await createDraftVersion(c, templateId, version, body, c.get("adminUser").id);
	await writeAudit(c, { action: "template_version.create", targetType: "template_version", targetId: versionId, reason: body.reason, after: { templateId, version } });
	return c.json(ok({ templateId, versionId, version }), 201);
});

app.post("/versions/:versionId/publish", async (c) => {
	const denied = requirePermission(c, "catalog.publish"); if (denied) return denied;
	const body = await parseBody(c, reasonSchema); if (isResponse(body)) return body;
	const db = getDb(c.env.DB); const versionId = c.req.param("versionId");
	const [version] = await db.select().from(schema.templateVersions).where(eq(schema.templateVersions.id, versionId)).limit(1); if (!version) return c.json(err("NOT_FOUND", "Template version not found"), 404);
	const [template] = await db.select().from(schema.templates).where(eq(schema.templates.id, version.templateId)).limit(1); const [pricing] = version.pricingVersionId ? await db.select().from(schema.pricingVersions).where(eq(schema.pricingVersions.id, version.pricingVersionId)).limit(1) : [];
	const bindings = await db.select({ active: schema.templatePipelineBindings.isActive, modelStatus: schema.providerModelVersions.status, modelVersionRef: schema.providerModelVersions.providerVersionRef, modelKey: schema.providerModels.modelKey, providerKey: schema.providers.providerKey }).from(schema.templatePipelineBindings).innerJoin(schema.providerModelVersions, eq(schema.templatePipelineBindings.providerModelVersionId, schema.providerModelVersions.id)).innerJoin(schema.providerModels, eq(schema.providerModelVersions.providerModelId, schema.providerModels.id)).innerJoin(schema.providers, eq(schema.providerModels.providerId, schema.providers.id)).where(and(eq(schema.templatePipelineBindings.templateVersionId, versionId), eq(schema.templatePipelineBindings.isActive, true)));
	const config = version.configSnapshot as Record<string, unknown>; const inputSchemaValid = TemplateInputSchema.safeParse(config?.inputSchema).success;
	const errors = validatePublishState({ templateLifecycle: template?.lifecycleStatus ?? "missing", versionStatus: version.status, pricingStatus: pricing?.status ?? null, bindingCount: bindings.length, unpublishedBindingCount: bindings.filter((binding) => binding.modelStatus !== "published").length, inputSchemaValid });
	const defaults = config.defaults && typeof config.defaults === "object" && !Array.isArray(config.defaults) ? config.defaults as Record<string, unknown> : {};
	const normalizedDefaults = NormalizedPVideoInput.safeParse({ prompt: "publish validation", ...defaults });
	const requiredDefaults = ["durationSec", "aspectRatio", "resolution", "fps", "draft", "promptUpsampling", "includeGeneratedAudio"].every((key) => Object.hasOwn(defaults, key));
	const binding = bindings[0];
	const normalized = normalizedDefaults.success ? normalizedDefaults.data : null;
	const parsedInputSchema = TemplateInputSchema.safeParse(config?.inputSchema);
	const capabilities = version.capabilities && typeof version.capabilities === "object" && !Array.isArray(version.capabilities)
		? version.capabilities as Record<string, unknown>
		: {};
	const durationField = parsedInputSchema.success ? parsedInputSchema.data.fields.find((field) => field.key === "durationSec") : undefined;
	const resolutionField = parsedInputSchema.success ? parsedInputSchema.data.fields.find((field) => field.key === "resolution") : undefined;
	const testSurfaceValid = parsedInputSchema.success
		&& !parsedInputSchema.data.fields.some((field) => field.type === "audio" || field.key === "audioUrl" || field.key === "includeGeneratedAudio")
		&& durationField?.type === "select"
		&& durationField.options.length === 1
		&& durationField.options[0]?.value === 1
		&& resolutionField?.type === "select"
		&& resolutionField.options.length === 1
		&& resolutionField.options[0]?.value === "720p"
		&& Array.isArray(capabilities.durations)
		&& capabilities.durations.length === 1
		&& capabilities.durations[0] === 1
		&& Array.isArray(capabilities.resolutions)
		&& capabilities.resolutions.length === 1
		&& capabilities.resolutions[0] === "720p"
		&& capabilities.supportsAudio === false;
	const testDefaultsValid = normalized !== null
		&& normalized.durationSec === 1
		&& normalized.resolution === "720p"
		&& normalized.fps === 24
		&& normalized.draft === true
		&& normalized.promptUpsampling === true
		&& normalized.includeGeneratedAudio === false;
	errors.push(...validatePVideoPublishState({ pipelineType: version.pipelineType, providerKey: binding?.providerKey ?? null, modelKey: binding?.modelKey ?? null, modelVersionRef: binding?.modelVersionRef ?? null, configProvider: config.provider, configModel: config.model, configModelVersion: config.modelVersion, defaultsValid: normalizedDefaults.success && requiredDefaults, mode: config.mode, testDefaultsValid, testSurfaceValid, pricingKey: pricing?.priceKey ?? null, creditAmount: pricing?.creditAmount ?? null }));
	if (version.pipelineType === "p_video" && bindings.length !== 1) errors.push("P-Video requires exactly one active pinned model binding");
	if (errors.length) return c.json(err("PUBLISH_VALIDATION_FAILED", errors.join("; ")), 409);
	const now = Date.now();
	const results = await c.env.DB.batch([
		c.env.DB.prepare(`UPDATE template_versions SET status = 'published', published_at = ?1 WHERE id = ?2 AND status = 'draft' AND EXISTS (SELECT 1 FROM templates WHERE id = ?3 AND lifecycle_status != 'archived' AND current_version_id IS ?4)`).bind(now, versionId, version.templateId, template?.currentVersionId ?? null),
		c.env.DB.prepare(`UPDATE templates SET current_version_id = ?1, lifecycle_status = 'active', is_active = 1, updated_at = ?2 WHERE id = ?3 AND lifecycle_status != 'archived' AND changes() = 1`).bind(versionId, now, version.templateId),
	]);
	const [committedVersion] = await db.select({ status: schema.templateVersions.status, publishedAt: schema.templateVersions.publishedAt }).from(schema.templateVersions).where(eq(schema.templateVersions.id, versionId)).limit(1);
	const [committedTemplate] = await db.select({ currentVersionId: schema.templates.currentVersionId }).from(schema.templates).where(eq(schema.templates.id, version.templateId)).limit(1);
	if (!publishCommitSucceeded({ versionChanges: results[0]?.meta.changes ?? 0, templateChanges: results[1]?.meta.changes ?? 0, versionStatus: committedVersion?.status ?? null, publishedAt: committedVersion?.publishedAt ?? null, expectedPublishedAt: now, currentVersionId: committedTemplate?.currentVersionId ?? null, expectedVersionId: versionId })) {
		return c.json(err("STALE_PUBLISH", "Template state changed during publishing; reload before trying again"), 409);
	}
	await cacheBust(c.env.KV); await writeAudit(c, { action: "template_version.publish", targetType: "template_version", targetId: versionId, reason: body.reason, before: version, after: { status: "published", currentVersionId: versionId } });
	return c.json(ok({ templateId: version.templateId, versionId, status: "published" }));
});

app.post("/:id/archive", async (c) => {
	const denied = requirePermission(c, "catalog.publish"); if (denied) return denied;
	const body = await parseBody(c, reasonSchema); if (isResponse(body)) return body; const db = getDb(c.env.DB); const id = c.req.param("id"); const [before] = await db.select().from(schema.templates).where(eq(schema.templates.id, id)).limit(1); if (!before) return c.json(err("NOT_FOUND", "Template not found"), 404);
	await db.update(schema.templates).set({ lifecycleStatus: "archived", isActive: false, updatedAt: Date.now() }).where(eq(schema.templates.id, id)); await cacheBust(c.env.KV); await writeAudit(c, { action: "template.archive", targetType: "template", targetId: id, reason: body.reason, before, after: { lifecycleStatus: "archived", isActive: false } }); return c.json(ok({ id, status: "archived" }));
});

export default app;

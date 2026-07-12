import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb, schema } from "@app/db";
import { GenerationParams, ProjectComposition } from "@app/shared";
import type { AppEnv } from "../env";
import { Errors, okJson } from "../lib/response";
import { checkRateLimit } from "../lib/rate-limit";

export const projects = new Hono<AppEnv>();

const CreateProjectBody = z.object({
	name: z.string().trim().min(1).max(200),
	templateId: z.string().nullable().optional(),
	brandId: z.string().nullable().optional(),
});

function operationKey(c: { req: { header(name: string): string | undefined } }, prefix: string): string {
	const supplied = c.req.header("idempotency-key");
	const suffix = supplied && /^[A-Za-z0-9._:-]{8,80}$/.test(supplied) ? supplied : crypto.randomUUID();
	return `${prefix}:${suffix}`;
}

function workflowId(prefix: string, projectId: string, key: string): string {
	return `${prefix}-${projectId}-${key.split(":").at(-1)}`.slice(0, 100);
}

projects.get("/", async (c) => {
	const userId = c.get("userId");
	const db = getDb(c.env.DB);
	const limit = Math.min(100, Math.max(1, Number(c.req.query("limit") ?? 50) || 50));
	const rows = await db.select().from(schema.projects)
		.where(eq(schema.projects.userId, userId)).orderBy(desc(schema.projects.updatedAt)).limit(limit);
	return okJson(c, rows);
});

projects.get("/:id", async (c) => {
	const userId = c.get("userId");
	const id = c.req.param("id");
	const db = getDb(c.env.DB);
	const row = await db.select().from(schema.projects)
		.where(and(eq(schema.projects.id, id), eq(schema.projects.userId, userId))).get();
	if (!row) return Errors.notFound(c, "Project not found");
	return okJson(c, row);
});

projects.post("/", zValidator("json", CreateProjectBody), async (c) => {
	const userId = c.get("userId");
	const body = c.req.valid("json");
	const db = getDb(c.env.DB);
	if (body.brandId) {
		const brand = await db.select({ id: schema.brands.id }).from(schema.brands)
			.where(and(eq(schema.brands.id, body.brandId), eq(schema.brands.userId, userId))).get();
		if (!brand) return Errors.badRequest(c, "Brand not found");
	}
	const id = nanoid();
	const now = Date.now();
	await db.insert(schema.projects).values({
		id, name: body.name, templateId: body.templateId ?? null, brandId: body.brandId ?? null,
		userId, generationStatus: "idle", schemaVersion: 1, createdAt: now, updatedAt: now,
	});
	const row = await db.select().from(schema.projects).where(eq(schema.projects.id, id)).get();
	return okJson(c, row, 201);
});

projects.delete("/:id", async (c) => {
	const userId = c.get("userId");
	const id = c.req.param("id");
	const db = getDb(c.env.DB);
	const existing = await db.select({ id: schema.projects.id }).from(schema.projects)
		.where(and(eq(schema.projects.id, id), eq(schema.projects.userId, userId))).get();
	if (!existing) return Errors.notFound(c, "Project not found");
	await db.delete(schema.projects).where(eq(schema.projects.id, id));
	return okJson(c, { id });
});

projects.patch("/:id/composition", zValidator("json", ProjectComposition), async (c) => {
	const userId = c.get("userId");
	const id = c.req.param("id");
	const composition = c.req.valid("json");
	const db = getDb(c.env.DB);
	const existing = await db.select({ id: schema.projects.id }).from(schema.projects)
		.where(and(eq(schema.projects.id, id), eq(schema.projects.userId, userId))).get();
	if (!existing) return Errors.notFound(c, "Project not found");
	await db.update(schema.projects).set({
		composition, script: composition.script, ratio: composition.ratio,
		length: String(composition.durationSec), language: composition.language,
		voice: composition.voice, voiceoverUrl: composition.voiceoverUrl,
		scenes: composition.scenes, captionConfig: composition.captions,
		schemaVersion: composition.schemaVersion, updatedAt: Date.now(),
	}).where(eq(schema.projects.id, id));
	return okJson(c, { id, saved: true });
});

const GenerateBody = GenerationParams.omit({ projectId: true, userId: true });

projects.post("/:id/generate", zValidator("json", GenerateBody), async (c) => {
	const userId = c.get("userId");
	const id = c.req.param("id");
	const body = c.req.valid("json");
	const db = getDb(c.env.DB);
	const existing = await db.select().from(schema.projects)
		.where(and(eq(schema.projects.id, id), eq(schema.projects.userId, userId))).get();
	if (!existing) return Errors.notFound(c, "Project not found");
	if (existing.generationStatus === "running" && existing.workflowInstanceId) {
		return okJson(c, { projectId: id, workflowInstanceId: existing.workflowInstanceId, generationStatus: "running" }, 202);
	}
	if (body.brandId) {
		const brand = await db.select({ id: schema.brands.id }).from(schema.brands)
			.where(and(eq(schema.brands.id, body.brandId), eq(schema.brands.userId, userId))).get();
		if (!brand) return Errors.badRequest(c, "Brand not found");
	}
	const rl = await checkRateLimit(c.env, userId, "generate", 2);
	if (!rl.allowed) return Errors.rateLimited(c);
	const params = GenerationParams.parse({ ...body, projectId: id, userId });
	const key = operationKey(c, `${userId}:generation:${id}`);
	const instanceId = workflowId("gen", id, key);
	const claim = await db.update(schema.projects).set({
		workflowInstanceId: instanceId, generationStatus: "running", generationRequestKey: key,
		generationParams: params, generationStage: "script", generationProgress: 0, generationError: null,
		templateId: body.templateId, brandId: body.brandId ?? null, updatedAt: Date.now(),
	}).where(and(eq(schema.projects.id, id), sql`${schema.projects.generationStatus} <> 'running'`));
	const changes = (claim as unknown as { meta?: { changes?: number } }).meta?.changes ?? 0;
	if (changes === 0) return Errors.conflict(c, "Generation is already running");
	try {
		await c.env.GENERATION_PIPELINE.create({ id: instanceId, params });
	} catch (error) {
		await db.update(schema.projects).set({
			generationStatus: "failed", generationStage: "failed", generationError: "Generation could not be started", updatedAt: Date.now(),
		}).where(and(eq(schema.projects.id, id), eq(schema.projects.workflowInstanceId, instanceId)));
		throw error;
	}
	return okJson(c, { projectId: id, workflowInstanceId: instanceId, generationStatus: "running" }, 202);
});

projects.get("/:id/generation-status", async (c) => {
	const userId = c.get("userId");
	const id = c.req.param("id");
	const db = getDb(c.env.DB);
	const row = await db.select().from(schema.projects)
		.where(and(eq(schema.projects.id, id), eq(schema.projects.userId, userId))).get();
	if (!row) return Errors.notFound(c, "Project not found");
	return okJson(c, {
		status: row.generationStatus ?? "idle",
		stage: row.generationStage ?? (row.generationStatus === "complete" ? "done" : "script"),
		progress: row.generationProgress ?? (row.generationStatus === "complete" ? 100 : 0),
		error: row.generationError ?? undefined,
		composition: row.generationStatus === "complete" ? row.composition ?? undefined : undefined,
		workflowInstanceId: row.workflowInstanceId ?? undefined,
	});
});

projects.post("/:id/generate/retry", async (c) => {
	const userId = c.get("userId");
	const projectId = c.req.param("id");
	const db = getDb(c.env.DB);
	const project = await db.select().from(schema.projects)
		.where(and(eq(schema.projects.id, projectId), eq(schema.projects.userId, userId))).get();
	if (!project) return Errors.notFound(c, "Project not found");
	if (project.generationStatus === "running") return Errors.conflict(c, "Generation is already running");
	if (!project.generationParams) return Errors.badRequest(c, "No previous generation parameters are available");
	const params = GenerationParams.parse(project.generationParams);
	const key = operationKey(c, `${userId}:generation-retry:${projectId}`);
	const instanceId = workflowId("retry", projectId, key);
	await db.update(schema.projects).set({
		generationStatus: "running", workflowInstanceId: instanceId, generationRequestKey: key,
		generationStage: "script", generationProgress: 0, generationError: null, updatedAt: Date.now(),
	}).where(eq(schema.projects.id, projectId));
	try {
		await c.env.GENERATION_PIPELINE.create({ id: instanceId, params });
	} catch (error) {
		await db.update(schema.projects).set({ generationStatus: "failed", generationStage: "failed", generationError: "Generation could not be restarted", updatedAt: Date.now() })
			.where(and(eq(schema.projects.id, projectId), eq(schema.projects.workflowInstanceId, instanceId)));
		throw error;
	}
	return okJson(c, { projectId, workflowInstanceId: instanceId, generationStatus: "running" }, 202);
});

const RegenerateImageBody = z.object({ prompt: z.string().trim().min(3).max(2_000).optional() });
projects.post("/:id/scenes/:sceneId/regenerate-image", zValidator("json", RegenerateImageBody), async (c) => {
	const userId = c.get("userId");
	const projectId = c.req.param("id");
	const sceneId = c.req.param("sceneId");
	const { prompt } = c.req.valid("json");
	const db = getDb(c.env.DB);
	const project = await db.select({ id: schema.projects.id }).from(schema.projects)
		.where(and(eq(schema.projects.id, projectId), eq(schema.projects.userId, userId))).get();
	if (!project) return Errors.notFound(c, "Project not found");
	const rl = await checkRateLimit(c.env, userId, "regenerate-image", 10);
	if (!rl.allowed) return Errors.rateLimited(c);
	const key = operationKey(c, `${userId}:regen-image:${projectId}:${sceneId}`);
	const instanceId = workflowId(`img-${sceneId}`, projectId, key);
	try {
		await c.env.REGEN_IMAGE.create({ id: instanceId, params: { projectId, userId, sceneId, newPrompt: prompt } });
	} catch {
		await c.env.REGEN_IMAGE.get(instanceId);
	}
	return okJson(c, { operationId: instanceId, status: "running" }, 202);
});

const RegenerateVoiceBody = z.object({ voice: z.string().trim().min(1).max(100) });
projects.post("/:id/voice/regenerate", zValidator("json", RegenerateVoiceBody), async (c) => {
	const userId = c.get("userId");
	const projectId = c.req.param("id");
	const { voice } = c.req.valid("json");
	const db = getDb(c.env.DB);
	const project = await db.select({ id: schema.projects.id }).from(schema.projects)
		.where(and(eq(schema.projects.id, projectId), eq(schema.projects.userId, userId))).get();
	if (!project) return Errors.notFound(c, "Project not found");
	const rl = await checkRateLimit(c.env, userId, "regenerate-voice", 5);
	if (!rl.allowed) return Errors.rateLimited(c);
	const key = operationKey(c, `${userId}:regen-voice:${projectId}`);
	const instanceId = workflowId("voice", projectId, key);
	try {
		await c.env.REGEN_VOICE.create({ id: instanceId, params: { projectId, userId, voice } });
	} catch {
		await c.env.REGEN_VOICE.get(instanceId);
	}
	return okJson(c, { operationId: instanceId, status: "running" }, 202);
});

const RewriteScriptBody = z.object({ instruction: z.string().trim().max(1_000).nullable().optional() });
projects.post("/:id/script/rewrite", zValidator("json", RewriteScriptBody), async (c) => {
	const userId = c.get("userId");
	const projectId = c.req.param("id");
	const { instruction } = c.req.valid("json");
	const db = getDb(c.env.DB);
	const project = await db.select({ id: schema.projects.id }).from(schema.projects)
		.where(and(eq(schema.projects.id, projectId), eq(schema.projects.userId, userId))).get();
	if (!project) return Errors.notFound(c, "Project not found");
	const rl = await checkRateLimit(c.env, userId, "rewrite-script", 5);
	if (!rl.allowed) return Errors.rateLimited(c);
	const key = operationKey(c, `${userId}:rewrite-script:${projectId}`);
	const instanceId = workflowId("script", projectId, key);
	try {
		await c.env.REWRITE_SCRIPT.create({ id: instanceId, params: { projectId, userId, instruction: instruction ?? undefined } });
	} catch {
		await c.env.REWRITE_SCRIPT.get(instanceId);
	}
	return okJson(c, { operationId: instanceId, status: "running" }, 202);
});

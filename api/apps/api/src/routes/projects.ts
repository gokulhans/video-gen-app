import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb, schema } from "@app/db";
import { ProjectComposition, GenerationParams } from "@app/shared";
import type { AppEnv } from "../env";
import { Errors, okJson } from "../lib/response";
import { checkRateLimit } from "../lib/rate-limit";

export const projects = new Hono<AppEnv>();

const CreateProjectBody = z.object({
	name: z.string().min(1).max(200),
	templateId: z.string().nullable().optional(),
	brandId: z.string().nullable().optional(),
});

// ---------- list (own only) ----------
projects.get("/", async (c) => {
	const userId = c.get("userId");
	const db = getDb(c.env.DB);
	const rows = await db
		.select()
		.from(schema.projects)
		.where(eq(schema.projects.userId, userId))
		.orderBy(desc(schema.projects.updatedAt));
	return okJson(c, rows);
});

// ---------- get ----------
projects.get("/:id", async (c) => {
	const userId = c.get("userId");
	const id = c.req.param("id");
	const db = getDb(c.env.DB);
	const row = await db
		.select()
		.from(schema.projects)
		.where(and(eq(schema.projects.id, id), eq(schema.projects.userId, userId)))
		.get();
	if (!row) return Errors.notFound(c, "Project not found");
	return okJson(c, row);
});

// ---------- create ----------
projects.post("/", zValidator("json", CreateProjectBody), async (c) => {
	const userId = c.get("userId");
	const body = c.req.valid("json");
	const db = getDb(c.env.DB);

	const id = nanoid();
	const now = Date.now();
	await db.insert(schema.projects).values({
		id,
		name: body.name,
		templateId: body.templateId ?? null,
		brandId: body.brandId ?? null,
		userId,
		generationStatus: "idle",
		schemaVersion: 1,
		createdAt: now,
		updatedAt: now,
	});

	const row = await db.select().from(schema.projects).where(eq(schema.projects.id, id)).get();
	return okJson(c, row, 201);
});

// ---------- delete ----------
projects.delete("/:id", async (c) => {
	const userId = c.get("userId");
	const id = c.req.param("id");
	const db = getDb(c.env.DB);

	const existing = await db
		.select({ id: schema.projects.id })
		.from(schema.projects)
		.where(and(eq(schema.projects.id, id), eq(schema.projects.userId, userId)))
		.get();
	if (!existing) return Errors.notFound(c, "Project not found");

	await db.delete(schema.projects).where(eq(schema.projects.id, id));
	return okJson(c, { id });
});

// ---------- autosave composition ----------
projects.patch("/:id/composition", zValidator("json", ProjectComposition), async (c) => {
	const userId = c.get("userId");
	const id = c.req.param("id");
	const composition = c.req.valid("json");
	const db = getDb(c.env.DB);

	const existing = await db
		.select({ id: schema.projects.id })
		.from(schema.projects)
		.where(and(eq(schema.projects.id, id), eq(schema.projects.userId, userId)))
		.get();
	if (!existing) return Errors.notFound(c, "Project not found");

	await db
		.update(schema.projects)
		.set({
			composition,
			script: composition.script,
			ratio: composition.ratio,
			length: String(composition.durationSec),
			language: composition.language,
			voice: composition.voice,
			voiceoverUrl: composition.voiceoverUrl,
			scenes: composition.scenes,
			captionConfig: composition.captions,
			schemaVersion: composition.schemaVersion,
			updatedAt: Date.now(),
		})
		.where(eq(schema.projects.id, id));

	return okJson(c, { id, saved: true });
});

// ---------- start generation workflow ----------
const GenerateBody = GenerationParams.omit({ projectId: true, userId: true });

projects.post("/:id/generate", zValidator("json", GenerateBody), async (c) => {
	const userId = c.get("userId");
	const id = c.req.param("id");
	const body = c.req.valid("json");
	const db = getDb(c.env.DB);

	const existing = await db
		.select()
		.from(schema.projects)
		.where(and(eq(schema.projects.id, id), eq(schema.projects.userId, userId)))
		.get();
	if (!existing) return Errors.notFound(c, "Project not found");

	const rl = await checkRateLimit(c.env, userId, "generate", 5);
	if (!rl.allowed) return Errors.rateLimited(c);

	const params = GenerationParams.parse({ ...body, projectId: id, userId });

	// Token deduction happens inside the Workflow itself (per CONTRACTS.md /
	// task spec — "deduct nothing here, the workflow deducts").
	const instance = await c.env.GENERATION_PIPELINE.create({ params });

	await db
		.update(schema.projects)
		.set({
			workflowInstanceId: instance.id,
			generationStatus: "running",
			templateId: body.templateId,
			brandId: body.brandId ?? null,
			updatedAt: Date.now(),
		})
		.where(eq(schema.projects.id, id));

	return okJson(c, { workflowInstanceId: instance.id, generationStatus: "running" }, 202);
});

// ---------- generation status ----------
projects.get("/:id/generation-status", async (c) => {
	const userId = c.get("userId");
	const id = c.req.param("id");
	const db = getDb(c.env.DB);

	const row = await db
		.select()
		.from(schema.projects)
		.where(and(eq(schema.projects.id, id), eq(schema.projects.userId, userId)))
		.get();
	if (!row) return Errors.notFound(c, "Project not found");

	if (!row.workflowInstanceId) {
		return okJson(c, { generationStatus: row.generationStatus ?? "idle", workflow: null });
	}

	const instance = await c.env.GENERATION_PIPELINE.get(row.workflowInstanceId);
	const status = await instance.status();

	return okJson(c, {
		generationStatus: row.generationStatus ?? "idle",
		workflowInstanceId: row.workflowInstanceId,
		workflow: status,
	});
});

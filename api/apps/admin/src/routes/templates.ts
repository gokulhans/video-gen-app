import { Hono } from "hono";
import { z } from "zod";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@app/db";
import { ok, err } from "@app/shared";
import type { AppBindings } from "../types.js";

const app = new Hono<AppBindings>();

const TEMPLATES_CACHE_KEY = "templates:v1";

const templateSchema = z.object({
	vertical: z.string().min(1),
	name: z.string().min(1),
	previewVideoUrl: z.string().nullable().optional(),
	scriptPromptPreset: z.string().min(1),
	imageStylePreset: z.string().min(1),
	musicTrackUrl: z.string().nullable().optional(),
	captionStyle: z.record(z.string(), z.unknown()).nullable().optional(),
	defaultDuration: z.number().int().min(1).optional(),
	isActive: z.boolean().optional(),
});

// GET /api/admin/templates
app.get("/", async (c) => {
	const db = getDb(c.env.DB);
	const rows = await db.select().from(schema.templates).orderBy(schema.templates.vertical, schema.templates.name);
	return c.json(ok(rows));
});

// GET /api/admin/templates/:id
app.get("/:id", async (c) => {
	const db = getDb(c.env.DB);
	const [row] = await db.select().from(schema.templates).where(eq(schema.templates.id, c.req.param("id"))).limit(1);
	if (!row) return c.json(err("NOT_FOUND", "Template not found"), 404);
	return c.json(ok(row));
});

// POST /api/admin/templates — bust KV "templates:v1"
app.post("/", async (c) => {
	const parsed = templateSchema.safeParse(await c.req.json().catch(() => ({})));
	if (!parsed.success) {
		return c.json(err("VALIDATION_ERROR", parsed.error.issues.map((i) => i.message).join(", ")), 400);
	}

	const db = getDb(c.env.DB);
	const id = nanoid();
	await db.insert(schema.templates).values({ id, ...parsed.data });
	await c.env.KV.delete(TEMPLATES_CACHE_KEY);

	const [row] = await db.select().from(schema.templates).where(eq(schema.templates.id, id)).limit(1);
	return c.json(ok(row), 201);
});

// PUT /api/admin/templates/:id — bust KV "templates:v1"
app.put("/:id", async (c) => {
	const id = c.req.param("id");
	const parsed = templateSchema.partial().safeParse(await c.req.json().catch(() => ({})));
	if (!parsed.success) {
		return c.json(err("VALIDATION_ERROR", parsed.error.issues.map((i) => i.message).join(", ")), 400);
	}

	const db = getDb(c.env.DB);
	const existing = await db.select({ id: schema.templates.id }).from(schema.templates).where(eq(schema.templates.id, id)).limit(1);
	if (!existing.length) return c.json(err("NOT_FOUND", "Template not found"), 404);

	await db
		.update(schema.templates)
		.set({ ...parsed.data, updatedAt: Date.now() })
		.where(eq(schema.templates.id, id));
	await c.env.KV.delete(TEMPLATES_CACHE_KEY);

	const [row] = await db.select().from(schema.templates).where(eq(schema.templates.id, id)).limit(1);
	return c.json(ok(row));
});

// DELETE /api/admin/templates/:id — bust KV "templates:v1"
app.delete("/:id", async (c) => {
	const id = c.req.param("id");
	const db = getDb(c.env.DB);
	const existing = await db.select({ id: schema.templates.id }).from(schema.templates).where(eq(schema.templates.id, id)).limit(1);
	if (!existing.length) return c.json(err("NOT_FOUND", "Template not found"), 404);

	await db.delete(schema.templates).where(eq(schema.templates.id, id));
	await c.env.KV.delete(TEMPLATES_CACHE_KEY);

	return c.json(ok({ id }));
});

export default app;

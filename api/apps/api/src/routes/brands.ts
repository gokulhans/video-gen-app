import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb, schema } from "@app/db";
import type { AppEnv } from "../env";
import { Errors, okJson } from "../lib/response";

export const brands = new Hono<AppEnv>();

const BrandBody = z.object({
	name: z.string().min(1).max(200),
	logoUrl: z.string().nullable().optional(),
	primaryColor: z.string().nullable().optional(),
	secondaryColor: z.string().nullable().optional(),
	font: z.string().nullable().optional(),
	phone: z.string().nullable().optional(),
	website: z.string().nullable().optional(),
	watermark: z.boolean().optional(),
});

// ---------- list (own only) ----------
brands.get("/", async (c) => {
	const userId = c.get("userId");
	const db = getDb(c.env.DB);
	const rows = await db
		.select()
		.from(schema.brands)
		.where(eq(schema.brands.userId, userId))
		.orderBy(desc(schema.brands.updatedAt));
	return okJson(c, rows);
});

// ---------- get ----------
brands.get("/:id", async (c) => {
	const userId = c.get("userId");
	const id = c.req.param("id");
	const db = getDb(c.env.DB);
	const row = await db
		.select()
		.from(schema.brands)
		.where(and(eq(schema.brands.id, id), eq(schema.brands.userId, userId)))
		.get();
	if (!row) return Errors.notFound(c, "Brand not found");
	return okJson(c, row);
});

// ---------- create ----------
brands.post("/", zValidator("json", BrandBody), async (c) => {
	const userId = c.get("userId");
	const body = c.req.valid("json");
	const db = getDb(c.env.DB);

	const id = nanoid();
	const now = Date.now();
	await db.insert(schema.brands).values({
		id,
		userId,
		name: body.name,
		logoUrl: body.logoUrl ?? null,
		primaryColor: body.primaryColor ?? null,
		secondaryColor: body.secondaryColor ?? null,
		font: body.font ?? null,
		phone: body.phone ?? null,
		website: body.website ?? null,
		watermark: body.watermark ?? true,
		createdAt: now,
		updatedAt: now,
	});

	const row = await db.select().from(schema.brands).where(eq(schema.brands.id, id)).get();
	return okJson(c, row, 201);
});

// ---------- update ----------
brands.patch("/:id", zValidator("json", BrandBody.partial()), async (c) => {
	const userId = c.get("userId");
	const id = c.req.param("id");
	const body = c.req.valid("json");
	const db = getDb(c.env.DB);

	const existing = await db
		.select({ id: schema.brands.id })
		.from(schema.brands)
		.where(and(eq(schema.brands.id, id), eq(schema.brands.userId, userId)))
		.get();
	if (!existing) return Errors.notFound(c, "Brand not found");

	await db
		.update(schema.brands)
		.set({ ...body, updatedAt: Date.now() })
		.where(eq(schema.brands.id, id));

	const row = await db.select().from(schema.brands).where(eq(schema.brands.id, id)).get();
	return okJson(c, row);
});

// ---------- delete ----------
brands.delete("/:id", async (c) => {
	const userId = c.get("userId");
	const id = c.req.param("id");
	const db = getDb(c.env.DB);

	const existing = await db
		.select({ id: schema.brands.id })
		.from(schema.brands)
		.where(and(eq(schema.brands.id, id), eq(schema.brands.userId, userId)))
		.get();
	if (!existing) return Errors.notFound(c, "Brand not found");

	await db.delete(schema.brands).where(eq(schema.brands.id, id));
	return okJson(c, { id });
});

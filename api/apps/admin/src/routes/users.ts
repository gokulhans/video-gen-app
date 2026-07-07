import { Hono } from "hono";
import { z } from "zod";
import { nanoid } from "nanoid";
import { and, count, desc, eq, like, or, sql } from "drizzle-orm";
import { getDb, schema } from "@app/db";
import { ok, err } from "@app/shared";
import type { AppBindings } from "../types.js";

const app = new Hono<AppBindings>();

// GET /api/admin/users?search=&page=&pageSize=
app.get("/", async (c) => {
	const db = getDb(c.env.DB);
	const search = (c.req.query("search") ?? "").trim();
	const page = Math.max(1, Number(c.req.query("page") ?? 1) || 1);
	const pageSize = Math.min(100, Math.max(1, Number(c.req.query("pageSize") ?? 20) || 20));
	const offset = (page - 1) * pageSize;

	const whereClause = search
		? or(like(schema.user.email, `%${search}%`), like(schema.user.name, `%${search}%`))
		: undefined;

	const items = await db
		.select({
			id: schema.user.id,
			name: schema.user.name,
			email: schema.user.email,
			tokens: schema.user.tokens,
			isAdmin: schema.user.isAdmin,
			createdAt: schema.user.createdAt,
		})
		.from(schema.user)
		.where(whereClause)
		.orderBy(desc(schema.user.createdAt))
		.limit(pageSize)
		.offset(offset);

	const [totalRow] = await db.select({ n: count() }).from(schema.user).where(whereClause);

	return c.json(ok({ items, page, pageSize, total: totalRow?.n ?? 0 }));
});

const grantTokensSchema = z.object({
	amount: z.number().int().refine((v) => v !== 0, "amount must be non-zero"),
	description: z.string().min(1).default("Admin grant"),
});

// POST /api/admin/users/:id/grant-tokens
// Uses db.batch for an atomic credit + admin_grant transaction row, per CONTRACTS.md.
app.post("/:id/grant-tokens", async (c) => {
	const userId = c.req.param("id");
	const parsed = grantTokensSchema.safeParse(await c.req.json().catch(() => ({})));
	if (!parsed.success) {
		return c.json(err("VALIDATION_ERROR", parsed.error.issues.map((i) => i.message).join(", ")), 400);
	}
	const { amount, description } = parsed.data;

	const db = getDb(c.env.DB);
	const existing = await db.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.id, userId)).limit(1);
	if (!existing.length) {
		return c.json(err("NOT_FOUND", "User not found"), 404);
	}

	const transactionId = nanoid();
	await db.batch([
		db
			.update(schema.user)
			.set({ tokens: sql`${schema.user.tokens} + ${amount}`, updatedAt: new Date() })
			.where(eq(schema.user.id, userId)),
		db.insert(schema.tokenTransactions).values({
			id: transactionId,
			userId,
			amount,
			type: "admin_grant",
			description,
		}),
	]);

	const [updated] = await db.select({ tokens: schema.user.tokens }).from(schema.user).where(eq(schema.user.id, userId)).limit(1);

	return c.json(ok({ userId, newBalance: updated?.tokens ?? null, transactionId }));
});

const toggleAdminSchema = z.object({ isAdmin: z.boolean() });

// POST /api/admin/users/:id/toggle-admin
app.post("/:id/toggle-admin", async (c) => {
	const userId = c.req.param("id");
	const parsed = toggleAdminSchema.safeParse(await c.req.json().catch(() => ({})));
	if (!parsed.success) {
		return c.json(err("VALIDATION_ERROR", parsed.error.issues.map((i) => i.message).join(", ")), 400);
	}

	const db = getDb(c.env.DB);
	const existing = await db.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.id, userId)).limit(1);
	if (!existing.length) {
		return c.json(err("NOT_FOUND", "User not found"), 404);
	}

	await db
		.update(schema.user)
		.set({ isAdmin: parsed.data.isAdmin, updatedAt: new Date() })
		.where(eq(schema.user.id, userId));

	return c.json(ok({ userId, isAdmin: parsed.data.isAdmin }));
});

export default app;

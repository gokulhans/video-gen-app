import { Hono } from "hono";
import { z } from "zod";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@app/db";
import { ok, err } from "@app/shared";
import type { AppBindings } from "../types.js";

const app = new Hono<AppBindings>();

// GET /api/admin/token-costs
app.get("/", async (c) => {
	const db = getDb(c.env.DB);
	const rows = await db.select().from(schema.tokenCosts).orderBy(schema.tokenCosts.action);
	return c.json(ok(rows));
});

const costSchema = z.object({
	cost: z.number().int().min(0),
	description: z.string().optional(),
	isActive: z.boolean().optional(),
});

// PUT /api/admin/token-costs/:action  — upsert by action, bust KV "costs" cache
app.put("/:action", async (c) => {
	const action = c.req.param("action");
	const parsed = costSchema.safeParse(await c.req.json().catch(() => ({})));
	if (!parsed.success) {
		return c.json(err("VALIDATION_ERROR", parsed.error.issues.map((i) => i.message).join(", ")), 400);
	}

	const db = getDb(c.env.DB);
	const existing = await db.select().from(schema.tokenCosts).where(eq(schema.tokenCosts.action, action)).limit(1);

	if (existing.length) {
		await db
			.update(schema.tokenCosts)
			.set({
				cost: parsed.data.cost,
				description: parsed.data.description ?? existing[0].description,
				isActive: parsed.data.isActive ?? existing[0].isActive,
				updatedAt: Date.now(),
			})
			.where(eq(schema.tokenCosts.action, action));
	} else {
		await db.insert(schema.tokenCosts).values({
			id: nanoid(),
			action,
			cost: parsed.data.cost,
			description: parsed.data.description ?? `Token cost for ${action}`,
			isActive: parsed.data.isActive ?? true,
		});
	}

	await c.env.KV.delete("costs");

	const [row] = await db.select().from(schema.tokenCosts).where(eq(schema.tokenCosts.action, action)).limit(1);
	return c.json(ok(row));
});

export default app;

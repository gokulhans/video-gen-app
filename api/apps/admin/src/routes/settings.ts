import { Hono } from "hono";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@app/db";
import { ok, err } from "@app/shared";
import type { AppBindings } from "../types.js";
import { writeAudit } from "../lib/audit.js";

const app = new Hono<AppBindings>();

const SETTINGS_ID = "system";

// GET /api/admin/settings — creates the default row on first access
app.get("/", async (c) => {
	const db = getDb(c.env.DB);
	let rows = await db.select().from(schema.settings).where(eq(schema.settings.id, SETTINGS_ID)).limit(1);
	if (!rows.length) {
		await db.insert(schema.settings).values({ id: SETTINGS_ID }).onConflictDoNothing();
		rows = await db.select().from(schema.settings).where(eq(schema.settings.id, SETTINGS_ID)).limit(1);
	}
	return c.json(ok(rows[0]));
});

const settingsSchema = z.object({
	reason: z.string().trim().min(3).max(500),
	defaultSignupBonus: z.number().int().min(0).optional(),
	minimumTokenBalance: z.number().int().min(0).optional(),
	enableTokenSystem: z.boolean().optional(),
	enableSignupBonus: z.boolean().optional(),
	maxTokensPerUser: z.number().int().min(0).optional(),
	tokenExpirationDays: z.number().int().min(0).optional(),
});

// PUT /api/admin/settings — partial update, bust KV "settings" cache
app.put("/", async (c) => {
	const parsed = settingsSchema.safeParse(await c.req.json().catch(() => ({})));
	if (!parsed.success) {
		return c.json(err("VALIDATION_ERROR", parsed.error.issues.map((i) => i.message).join(", ")), 400);
	}

	const db = getDb(c.env.DB);
	const existing = await db.select().from(schema.settings).where(eq(schema.settings.id, SETTINGS_ID)).limit(1);

	const { reason, ...changes } = parsed.data;
	if (existing.length) {
		await db
			.update(schema.settings)
			.set({ ...changes, updatedAt: Date.now() })
			.where(eq(schema.settings.id, SETTINGS_ID));
	} else {
		await db.insert(schema.settings).values({ id: SETTINGS_ID, ...changes });
	}

	await c.env.KV.delete("settings");

	const [row] = await db.select().from(schema.settings).where(eq(schema.settings.id, SETTINGS_ID)).limit(1);
	await writeAudit(c, { action: "settings.update", targetType: "settings", targetId: SETTINGS_ID, reason, before: existing[0] ?? null, after: row });
	return c.json(ok(row));
});

export default app;

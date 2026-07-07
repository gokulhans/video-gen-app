import { Hono } from "hono";
import { eq, and, desc } from "drizzle-orm";
import { getDb, schema } from "@app/db";
import type { AppEnv } from "../env";
import { Errors, okJson } from "../lib/response";

export const notifications = new Hono<AppEnv>();

// ---------- GET / (list, newest first) ----------
notifications.get("/", async (c) => {
	const userId = c.get("userId");
	const db = getDb(c.env.DB);
	const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
	const rows = await db
		.select()
		.from(schema.notifications)
		.where(eq(schema.notifications.userId, userId))
		.orderBy(desc(schema.notifications.createdAt))
		.limit(limit);
	return okJson(c, rows);
});

// ---------- POST /:id/read ----------
notifications.post("/:id/read", async (c) => {
	const userId = c.get("userId");
	const id = c.req.param("id");
	const db = getDb(c.env.DB);

	const existing = await db
		.select({ id: schema.notifications.id })
		.from(schema.notifications)
		.where(and(eq(schema.notifications.id, id), eq(schema.notifications.userId, userId)))
		.get();
	if (!existing) return Errors.notFound(c, "Notification not found");

	await db.update(schema.notifications).set({ isRead: true }).where(eq(schema.notifications.id, id));
	return okJson(c, { id, isRead: true });
});

// ---------- POST /read-all ----------
notifications.post("/read-all", async (c) => {
	const userId = c.get("userId");
	const db = getDb(c.env.DB);
	await db
		.update(schema.notifications)
		.set({ isRead: true })
		.where(eq(schema.notifications.userId, userId));
	return okJson(c, { ok: true });
});

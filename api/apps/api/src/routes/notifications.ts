import { Hono } from "hono";
import { and, desc, eq, lt, or, sql } from "drizzle-orm";
import { getDb, schema } from "@app/db";
import type { AppEnv } from "../env";
import { Errors, okJson } from "../lib/response";
import { decodeNotificationCursor,encodeNotificationCursor,notificationDeepLink } from "../lib/brand-notification";

export const notifications = new Hono<AppEnv>();

function withDeepLink<T extends { deepLink: string | null; jobId: string | null; projectId: string | null; type: string }>(row: T) {
	return { ...row, deepLink:notificationDeepLink(row) };
}

notifications.get("/unread-count", async (c) => {
	const row = await getDb(c.env.DB).select({ count: sql<number>`count(*)` }).from(schema.notifications)
		.where(and(eq(schema.notifications.userId,c.get("userId")),eq(schema.notifications.isRead,false))).get();
	return okJson(c,{ count:Number(row?.count ?? 0) });
});

notifications.get("/", async (c) => {
	const limit = Math.min(100,Math.max(1,Number(c.req.query("limit") ?? 30) || 30));
	const rawCursor = c.req.query("cursor");
	const cursor = decodeNotificationCursor(rawCursor);
	if (rawCursor && !cursor) return Errors.validation(c,"Invalid notification cursor");
	const predicates = [eq(schema.notifications.userId,c.get("userId"))];
	if (cursor) predicates.push(or(
		lt(schema.notifications.createdAt,cursor.createdAt),
		and(eq(schema.notifications.createdAt,cursor.createdAt),lt(schema.notifications.id,cursor.id)),
	)!);
	const rows = await getDb(c.env.DB).select().from(schema.notifications).where(and(...predicates))
		.orderBy(desc(schema.notifications.createdAt),desc(schema.notifications.id)).limit(limit+1);
	const page = rows.slice(0,limit);
	const last = page.at(-1);
	return okJson(c,{ items:page.map(withDeepLink), nextCursor:rows.length>limit && last ? encodeNotificationCursor(last.createdAt,last.id) : null });
});

notifications.post("/read-all", async (c) => {
	const now=Date.now();
	await getDb(c.env.DB).update(schema.notifications).set({ isRead:true,readAt:now })
		.where(and(eq(schema.notifications.userId,c.get("userId")),eq(schema.notifications.isRead,false)));
	return okJson(c,{ ok:true,readAt:now });
});

notifications.post("/:id/read", async (c) => {
	const now=Date.now();
	const result=await c.env.DB.prepare("UPDATE notifications SET is_read=1,read_at=COALESCE(read_at,?) WHERE id=? AND user_id=?")
		.bind(now,c.req.param("id"),c.get("userId")).run();
	return (result.meta.changes ?? 0)>0 ? okJson(c,{ id:c.req.param("id"),isRead:true,readAt:now }) : Errors.notFound(c,"Notification not found");
});

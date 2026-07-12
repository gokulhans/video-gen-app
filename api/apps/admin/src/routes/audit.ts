import { Hono } from "hono";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@app/db";
import { err, ok } from "@app/shared";
import type { AppBindings } from "../types.js";
import { requirePermission } from "../lib/http.js";

const app = new Hono<AppBindings>();
const querySchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50), action: z.string().trim().max(100).optional(), targetType: z.string().trim().max(100).optional() });

app.get("/", async (c) => {
	const denied = requirePermission(c, "audit.read"); if (denied) return denied;
	const parsed = querySchema.safeParse(c.req.query()); if (!parsed.success) return c.json(err("VALIDATION_ERROR", "Invalid audit query"), 400);
	const conditions = []; if (parsed.data.action) conditions.push(eq(schema.adminAuditEvents.action, parsed.data.action)); if (parsed.data.targetType) conditions.push(eq(schema.adminAuditEvents.targetType, parsed.data.targetType));
	const rows = await getDb(c.env.DB).select({ id: schema.adminAuditEvents.id, actorUserId: schema.adminAuditEvents.actorUserId, actorEmail: schema.user.email, requestId: schema.adminAuditEvents.requestId, action: schema.adminAuditEvents.action, targetType: schema.adminAuditEvents.targetType, targetId: schema.adminAuditEvents.targetId, reason: schema.adminAuditEvents.reason, beforeSummary: schema.adminAuditEvents.beforeSummary, afterSummary: schema.adminAuditEvents.afterSummary, createdAt: schema.adminAuditEvents.createdAt }).from(schema.adminAuditEvents).leftJoin(schema.user, eq(schema.adminAuditEvents.actorUserId, schema.user.id)).where(conditions.length ? and(...conditions) : undefined).orderBy(desc(schema.adminAuditEvents.createdAt)).limit(parsed.data.limit);
	return c.json(ok(rows));
});
export default app;

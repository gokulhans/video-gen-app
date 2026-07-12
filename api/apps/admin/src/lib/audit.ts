import { nanoid } from "nanoid";
import { getDb, schema } from "@app/db";
import type { Context } from "hono";
import type { AppBindings } from "../types.js";
import { sanitizeAuditValue } from "./audit-sanitize.js";

export async function writeAudit(c: Context<AppBindings>, event: {
	action: string; targetType: string; targetId?: string | null; reason?: string | null; before?: unknown; after?: unknown;
}): Promise<void> {
	const db = getDb(c.env.DB);
	await db.insert(schema.adminAuditEvents).values({
		id: nanoid(), actorUserId: c.get("adminUser").id, requestId: c.get("requestId"),
		action: event.action, targetType: event.targetType, targetId: event.targetId ?? null,
		reason: event.reason?.slice(0, 500) ?? null,
		beforeSummary: sanitizeAuditValue(event.before), afterSummary: sanitizeAuditValue(event.after),
	});
}

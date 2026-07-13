import type { Context, Next } from "hono";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@app/db";
import { err } from "@app/shared";
import type { AppBindings } from "../types.js";
import { parsePermissions } from "../lib/permissions.js";
import { parseStoredAdminSession, sessionKeyFromBearerToken, type StoredAuthSession } from "../lib/admin-session.js";

/** Validate Better Auth through the API Worker, then resolve admin/RBAC in D1. */
export async function requireAdmin(c: Context<AppBindings>, next: Next) {
	const authHeader = c.req.header("Authorization") ?? "";
	const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
	if (!token) return c.json(err("UNAUTHORIZED", "Missing bearer token"), 401);

	let authBody: StoredAuthSession;
	try {
		// Better Auth's bearer response is a signed cookie value. Its first
		// segment is the raw session token used as the shared KV key.
		const sessionToken = sessionKeyFromBearerToken(token);
		const sessionRecord = await c.env.KV.get(sessionToken);
		if (!sessionRecord) return c.json(err("UNAUTHORIZED", "Invalid or expired session"), 401);
		const parsed = parseStoredAdminSession(sessionRecord);
		if (!parsed) return c.json(err("UNAUTHORIZED", "Invalid or expired session"), 401);
		authBody = parsed;
	} catch {
		return c.json(err("UNAUTHORIZED", "Invalid or expired session"), 401);
	}

	const authSession = authBody?.session;
	const authUser = authBody?.user;
	if (!authSession || !authUser.id) return c.json(err("UNAUTHORIZED", "Invalid or expired session"), 401);

	const db = getDb(c.env.DB);
	const rows = await db
		.select({ userId: schema.user.id, email: schema.user.email, name: schema.user.name, isAdmin: schema.user.isAdmin })
		.from(schema.user)
		.where(eq(schema.user.id, authUser.id))
		.limit(1);
	const row = rows[0];
	if (!row) return c.json(err("UNAUTHORIZED", "Session user not found in admin database"), 401);

	const roleRows = await db
		.select({ permissions: schema.adminRoles.permissions })
		.from(schema.adminUserRoles)
		.innerJoin(schema.adminRoles, eq(schema.adminUserRoles.roleId, schema.adminRoles.id))
		.where(eq(schema.adminUserRoles.userId, row.userId));
	const permissions = [...new Set(roleRows.flatMap((role) => parsePermissions(role.permissions)))];
	if (!row.isAdmin && permissions.length === 0) return c.json(err("FORBIDDEN", "Admin access required"), 403);

	c.set("adminUser", { id: row.userId, email: row.email, name: row.name, isSuperAdmin: row.isAdmin, permissions });
	await next();
}

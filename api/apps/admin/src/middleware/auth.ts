import type { Context, Next } from "hono";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@app/db";
import { err } from "@app/shared";
import type { AppBindings } from "../types.js";
import { parsePermissions } from "../lib/permissions.js";
import type { StoredAuthSession } from "../lib/admin-session.js";

/** Validate Better Auth through the API Worker, then resolve admin/RBAC in D1. */
export async function requireAdmin(c: Context<AppBindings>, next: Next) {
	const authHeader = c.req.header("Authorization") ?? "";
	const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
	if (!token) return c.json(err("UNAUTHORIZED", "Missing bearer token"), 401);

	let authBody: StoredAuthSession;
	try {
		// Ask the API Worker to validate the Better Auth bearer token. This keeps
		// local API and admin Workers independent: their local KV stores are not
		// shared, while deployed Workers can still validate through the same API.
		const authResponse = await fetch(`${c.env.AUTH_API_URL.replace(/\/$/, "")}/get-session`, {
			headers: { Authorization: `Bearer ${token}` },
		});
		if (!authResponse.ok) return c.json(err("UNAUTHORIZED", "Invalid or expired session"), 401);
		authBody = (await authResponse.json()) as StoredAuthSession;
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

import type { Context, Next } from "hono";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@app/db";
import { err } from "@app/shared";
import type { AppBindings } from "../types.js";

/**
 * Bearer-token session check against the D1 `session` table (better-auth's
 * schema), joined to `user` to verify `isAdmin`. No dependency on the
 * better-auth library itself — this is a direct, read-only D1 lookup.
 */
export async function requireAdmin(c: Context<AppBindings>, next: Next) {
	const authHeader = c.req.header("Authorization") ?? "";
	const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

	if (!token) {
		return c.json(err("UNAUTHORIZED", "Missing bearer token"), 401);
	}

	const db = getDb(c.env.DB);
	const rows = await db
		.select({
			userId: schema.user.id,
			email: schema.user.email,
			name: schema.user.name,
			isAdmin: schema.user.isAdmin,
			expiresAt: schema.session.expiresAt,
		})
		.from(schema.session)
		.innerJoin(schema.user, eq(schema.session.userId, schema.user.id))
		.where(eq(schema.session.token, token))
		.limit(1);

	const row = rows[0];
	if (!row) {
		return c.json(err("UNAUTHORIZED", "Invalid or expired session"), 401);
	}
	if (row.expiresAt.getTime() < Date.now()) {
		return c.json(err("UNAUTHORIZED", "Session expired"), 401);
	}
	if (!row.isAdmin) {
		return c.json(err("FORBIDDEN", "Admin access required"), 403);
	}

	c.set("adminUser", { id: row.userId, email: row.email, name: row.name });
	await next();
}

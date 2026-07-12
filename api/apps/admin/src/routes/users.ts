import { Hono } from "hono";
import { z } from "zod";
import { nanoid } from "nanoid";
import { and, count, desc, eq, like, or, sql } from "drizzle-orm";
import { getDb, schema } from "@app/db";
import { ok, err } from "@app/shared";
import type { AppBindings } from "../types.js";
import { writeAudit } from "../lib/audit.js";

const app = new Hono<AppBindings>();

const roleAssignmentSchema = z.object({
	roleIds: z.array(z.string().trim().min(1).max(128)).max(20),
	reason: z.string().trim().min(3).max(500),
}).strict();

// Role definitions are intentionally immutable through this surface. Changes
// to permission sets ship as reviewed migrations; operators only assign them.
app.get("/roles", async (c) => {
	const db = getDb(c.env.DB);
	return c.json(ok(await db.select().from(schema.adminRoles).orderBy(schema.adminRoles.name)));
});

app.get("/:id/roles", async (c) => {
	const db = getDb(c.env.DB);
	const userId = c.req.param("id");
	const [target] = await db.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.id, userId)).limit(1);
	if (!target) return c.json(err("NOT_FOUND", "User not found"), 404);
	const assignments = await db.select({ roleId: schema.adminUserRoles.roleId }).from(schema.adminUserRoles).where(eq(schema.adminUserRoles.userId, userId));
	return c.json(ok({ userId, roleIds: assignments.map((row) => row.roleId) }));
});

app.post("/:id/roles", async (c) => {
	const userId = c.req.param("id");
	const parsed = roleAssignmentSchema.safeParse(await c.req.json().catch(() => ({})));
	if (!parsed.success) return c.json(err("VALIDATION_ERROR", parsed.error.issues.map((issue) => issue.message).join(", ")), 400);
	const roleIds = [...new Set(parsed.data.roleIds)].sort();
	const db = getDb(c.env.DB);
	const [target] = await db.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.id, userId)).limit(1);
	if (!target) return c.json(err("NOT_FOUND", "User not found"), 404);
	const roles = await db.select({ id: schema.adminRoles.id }).from(schema.adminRoles);
	const validIds = new Set(roles.map((role) => role.id));
	if (roleIds.some((id) => !validIds.has(id))) return c.json(err("VALIDATION_ERROR", "One or more roles do not exist"), 400);
	const beforeRows = await db.select({ roleId: schema.adminUserRoles.roleId }).from(schema.adminUserRoles).where(eq(schema.adminUserRoles.userId, userId));
	const beforeRoleIds = beforeRows.map((row) => row.roleId).sort();
	if (JSON.stringify(beforeRoleIds) === JSON.stringify(roleIds)) return c.json(ok({ userId, roleIds }));
	const now = Date.now();
	const actor = c.get("adminUser").id;
	await c.env.DB.batch([
		c.env.DB.prepare("DELETE FROM admin_user_roles WHERE user_id = ?1").bind(userId),
		...roleIds.map((roleId) => c.env.DB.prepare("INSERT INTO admin_user_roles (user_id, role_id, granted_by, created_at) VALUES (?1, ?2, ?3, ?4)").bind(userId, roleId, actor, now)),
		c.env.DB.prepare("INSERT INTO admin_audit_events (id, actor_user_id, request_id, action, target_type, target_id, reason, before_summary, after_summary, created_at) VALUES (?1, ?2, ?3, 'user.roles.replace', 'user', ?4, ?5, ?6, ?7, ?8)")
			.bind(nanoid(), actor, c.get("requestId"), userId, parsed.data.reason, JSON.stringify({ roleIds: beforeRoleIds }), JSON.stringify({ roleIds }), now),
	]);
	return c.json(ok({ userId, roleIds }));
});

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
	reason: z.string().trim().min(3).max(500),
});

// POST /api/admin/users/:id/grant-tokens
// Uses db.batch for an atomic credit + admin_grant transaction row, per CONTRACTS.md.
app.post("/:id/grant-tokens", async (c) => {
	const userId = c.req.param("id");
	const parsed = grantTokensSchema.safeParse(await c.req.json().catch(() => ({})));
	if (!parsed.success) {
		return c.json(err("VALIDATION_ERROR", parsed.error.issues.map((i) => i.message).join(", ")), 400);
	}
	const { amount, description, reason } = parsed.data;

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
	await writeAudit(c, { action: "user.tokens.adjust", targetType: "user", targetId: userId, reason, before: { balance: updated ? updated.tokens - amount : null }, after: { balance: updated?.tokens ?? null, amount, transactionId } });

	return c.json(ok({ userId, newBalance: updated?.tokens ?? null, transactionId }));
});

const toggleAdminSchema = z.object({ isAdmin: z.boolean(), reason: z.string().trim().min(3).max(500) }).strict();

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
	await writeAudit(c, { action: parsed.data.isAdmin ? "user.super_admin.grant" : "user.super_admin.revoke", targetType: "user", targetId: userId, reason: parsed.data.reason, before: { isAdmin: !parsed.data.isAdmin }, after: { isAdmin: parsed.data.isAdmin } });

	return c.json(ok({ userId, isAdmin: parsed.data.isAdmin }));
});

export default app;

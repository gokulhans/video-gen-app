import { Hono } from "hono";
import { and, count, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@app/db";
import { ok } from "@app/shared";
import type { AppBindings } from "../types.js";

const app = new Hono<AppBindings>();

// GET /api/admin/transactions?userId=&type=&page=&pageSize=
app.get("/", async (c) => {
	const db = getDb(c.env.DB);
	const userId = c.req.query("userId");
	const type = c.req.query("type");
	const page = Math.max(1, Number(c.req.query("page") ?? 1) || 1);
	const pageSize = Math.min(100, Math.max(1, Number(c.req.query("pageSize") ?? 20) || 20));
	const offset = (page - 1) * pageSize;

	const conditions = [];
	if (userId) conditions.push(eq(schema.tokenTransactions.userId, userId));
	if (type) conditions.push(eq(schema.tokenTransactions.type, type));
	const whereClause = conditions.length ? and(...conditions) : undefined;

	const items = await db
		.select({
			id: schema.tokenTransactions.id,
			userId: schema.tokenTransactions.userId,
			amount: schema.tokenTransactions.amount,
			type: schema.tokenTransactions.type,
			description: schema.tokenTransactions.description,
			projectId: schema.tokenTransactions.projectId,
			createdAt: schema.tokenTransactions.createdAt,
			userEmail: schema.user.email,
			userName: schema.user.name,
		})
		.from(schema.tokenTransactions)
		.leftJoin(schema.user, eq(schema.tokenTransactions.userId, schema.user.id))
		.where(whereClause)
		.orderBy(desc(schema.tokenTransactions.createdAt))
		.limit(pageSize)
		.offset(offset);

	const [totalRow] = await db.select({ n: count() }).from(schema.tokenTransactions).where(whereClause);

	return c.json(ok({ items, page, pageSize, total: totalRow?.n ?? 0 }));
});

export default app;

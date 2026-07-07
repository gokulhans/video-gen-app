import { Hono } from "hono";
import { count, sql } from "drizzle-orm";
import { getDb, schema } from "@app/db";
import { ok } from "@app/shared";
import type { AppBindings } from "../types.js";

const app = new Hono<AppBindings>();

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

app.get("/", async (c) => {
	const db = getDb(c.env.DB);
	const thirtyDaysAgo = Date.now() - THIRTY_DAYS_MS;

	const [userCountRow] = await db.select({ n: count() }).from(schema.user);
	const [projectCountRow] = await db.select({ n: count() }).from(schema.projects);

	const rendersByStatusRows = await db
		.select({ status: schema.renderJobs.status, n: count() })
		.from(schema.renderJobs)
		.groupBy(schema.renderJobs.status);

	const [tokensSpentRow] = await db
		.select({
			total: sql<number>`COALESCE(SUM(CASE WHEN ${schema.tokenTransactions.amount} < 0 AND ${schema.tokenTransactions.createdAt} >= ${thirtyDaysAgo} THEN -${schema.tokenTransactions.amount} ELSE 0 END), 0)`,
		})
		.from(schema.tokenTransactions);

	const rendersByStatus: Record<string, number> = {};
	for (const row of rendersByStatusRows) {
		rendersByStatus[row.status] = row.n;
	}

	return c.json(
		ok({
			userCount: userCountRow?.n ?? 0,
			projectCount: projectCountRow?.n ?? 0,
			rendersByStatus,
			tokensSpentLast30d: tokensSpentRow?.total ?? 0,
		})
	);
});

export default app;

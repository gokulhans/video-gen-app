import { Hono } from "hono";
import { count, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@app/db";
import { ok } from "@app/shared";
import type { AppBindings } from "../types.js";

const app = new Hono<AppBindings>();

// GET /api/admin/render-jobs?status=&page=&pageSize=
app.get("/", async (c) => {
	const db = getDb(c.env.DB);
	const status = c.req.query("status");
	const page = Math.max(1, Number(c.req.query("page") ?? 1) || 1);
	const pageSize = Math.min(100, Math.max(1, Number(c.req.query("pageSize") ?? 20) || 20));
	const offset = (page - 1) * pageSize;

	const whereClause = status ? eq(schema.renderJobs.status, status) : undefined;

	const items = await db
		.select({
			id: schema.renderJobs.id,
			userId: schema.renderJobs.userId,
			projectId: schema.renderJobs.projectId,
			resolution: schema.renderJobs.resolution,
			status: schema.renderJobs.status,
			videoUrl: schema.renderJobs.videoUrl,
			progress: schema.renderJobs.progress,
			error: schema.renderJobs.error,
			createdAt: schema.renderJobs.createdAt,
			updatedAt: schema.renderJobs.updatedAt,
			userEmail: schema.user.email,
		})
		.from(schema.renderJobs)
		.leftJoin(schema.user, eq(schema.renderJobs.userId, schema.user.id))
		.where(whereClause)
		.orderBy(desc(schema.renderJobs.createdAt))
		.limit(pageSize)
		.offset(offset);

	const [totalRow] = await db.select({ n: count() }).from(schema.renderJobs).where(whereClause);

	return c.json(ok({ items, page, pageSize, total: totalRow?.n ?? 0 }));
});

export default app;

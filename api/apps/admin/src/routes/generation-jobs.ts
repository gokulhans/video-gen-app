import { Hono } from "hono";
import { z } from "zod";
import { and, count, desc, eq, like, or } from "drizzle-orm";
import { getDb, schema } from "@app/db";
import { err, ok } from "@app/shared";
import type { AppBindings } from "../types.js";
import { requirePermission } from "../lib/http.js";

const app = new Hono<AppBindings>();
const querySchema = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25), status: z.string().trim().max(50).optional(), search: z.string().trim().max(120).optional() });

app.get("/", async (c) => {
	const denied = requirePermission(c, "jobs.read"); if (denied) return denied;
	const parsed = querySchema.safeParse(c.req.query()); if (!parsed.success) return c.json(err("VALIDATION_ERROR", "Invalid job query"), 400);
	const { page, pageSize, status, search } = parsed.data; const conditions = [];
	if (status) conditions.push(eq(schema.generationJobs.status, status));
	if (search) conditions.push(or(like(schema.generationJobs.id, `%${search}%`), like(schema.user.email, `%${search}%`), like(schema.templates.name, `%${search}%`))!);
	const where = conditions.length ? and(...conditions) : undefined; const db = getDb(c.env.DB);
	const items = await db.select({ id: schema.generationJobs.id, userId: schema.generationJobs.userId, userEmail: schema.user.email, templateId: schema.generationJobs.templateId, templateName: schema.templates.name, templateVersionId: schema.generationJobs.templateVersionId, status: schema.generationJobs.status, progress: schema.generationJobs.progress, quotedCredits: schema.generationJobs.quotedCredits, estimatedCostMicros: schema.generationJobs.estimatedCostMicros, actualCostMicros: schema.generationJobs.actualCostMicros, errorCode: schema.generationJobs.errorCode, createdAt: schema.generationJobs.createdAt, updatedAt: schema.generationJobs.updatedAt, completedAt: schema.generationJobs.completedAt }).from(schema.generationJobs).leftJoin(schema.user, eq(schema.generationJobs.userId, schema.user.id)).leftJoin(schema.templates, eq(schema.generationJobs.templateId, schema.templates.id)).where(where).orderBy(desc(schema.generationJobs.createdAt)).limit(pageSize).offset((page - 1) * pageSize);
	const [total] = await db.select({ value: count() }).from(schema.generationJobs).leftJoin(schema.user, eq(schema.generationJobs.userId, schema.user.id)).leftJoin(schema.templates, eq(schema.generationJobs.templateId, schema.templates.id)).where(where);
	return c.json(ok({ items, page, pageSize, total: total?.value ?? 0 }));
});

app.get("/:id", async (c) => {
	const denied = requirePermission(c, "jobs.read"); if (denied) return denied;
	const db = getDb(c.env.DB); const id = c.req.param("id");
	const [job] = await db.select().from(schema.generationJobs).where(eq(schema.generationJobs.id, id)).limit(1);
	if (!job) return c.json(err("NOT_FOUND", "Generation job not found"), 404);
	const [attempts, events, assets, reservation] = await Promise.all([
		db.select().from(schema.generationAttempts).where(eq(schema.generationAttempts.jobId, id)).orderBy(schema.generationAttempts.attemptNumber),
		db.select().from(schema.generationJobEvents).where(eq(schema.generationJobEvents.jobId, id)).orderBy(schema.generationJobEvents.createdAt),
		db.select().from(schema.generationAssets).where(eq(schema.generationAssets.jobId, id)).orderBy(schema.generationAssets.createdAt),
		db.select().from(schema.creditReservations).where(eq(schema.creditReservations.jobId, id)).limit(1),
	]);
	return c.json(ok({ job, attempts, events, assets, reservation: reservation[0] ?? null, allowedActions: [] }));
});

export default app;

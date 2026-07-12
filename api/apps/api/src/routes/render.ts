import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb, schema } from "@app/db";
import type { RenderQueueMessage } from "@app/shared";
import { DEFAULT_TOKEN_COSTS } from "@app/shared";
import type { AppEnv } from "../env";
import { Errors, okJson } from "../lib/response";
import { checkRateLimit } from "../lib/rate-limit";
import { presignGet } from "../lib/r2";

export const render = new Hono<AppEnv>();

const RenderBody = z.object({
	resolution: z.enum(["720p", "1080p"]),
});

// ---------- POST /projects/:id/render ----------
render.post("/projects/:id/render", zValidator("json", RenderBody), async (c) => {
	const userId = c.get("userId");
	const projectId = c.req.param("id");
	const { resolution } = c.req.valid("json");
	const db = getDb(c.env.DB);
	const suppliedKey = c.req.header("idempotency-key");
	const keySuffix = suppliedKey && /^[A-Za-z0-9._:-]{8,80}$/.test(suppliedKey) ? suppliedKey : crypto.randomUUID();
	const idempotencyKey = `${userId}:render:${keySuffix}`;
	const previous = await db.select().from(schema.renderJobs)
		.where(and(eq(schema.renderJobs.userId, userId), eq(schema.renderJobs.idempotencyKey, idempotencyKey))).get();
	if (previous) return okJson(c, previous, 202);

	const rl = await checkRateLimit(c.env, userId, "render", 3);
	if (!rl.allowed) return Errors.rateLimited(c);

	const project = await db
		.select({ id: schema.projects.id })
		.from(schema.projects)
		.where(and(eq(schema.projects.id, projectId), eq(schema.projects.userId, userId)))
		.get();
	if (!project) return Errors.notFound(c, "Project not found");

	const action = resolution === "1080p" ? "render_1080p" : "render_720p";
	const costRow = await db
		.select()
		.from(schema.tokenCosts)
		.where(and(eq(schema.tokenCosts.action, action), eq(schema.tokenCosts.isActive, true)))
		.get();
	const cost = costRow?.cost ?? DEFAULT_TOKEN_COSTS[action];

	const jobId = nanoid();
	const now = Date.now();
	const nowDate = new Date();

	const updateResult = await db
			.update(schema.user)
			.set({ tokens: sql`${schema.user.tokens} - ${cost}`, updatedAt: nowDate })
			.where(and(eq(schema.user.id, userId), sql`${schema.user.tokens} >= ${cost}`));

	const rowsAffected =
		(updateResult as unknown as { meta?: { changes?: number }; rowsAffected?: number })?.meta
			?.changes ??
		(updateResult as unknown as { rowsAffected?: number })?.rowsAffected ??
		0;
	if (rowsAffected === 0) {
		return Errors.insufficientTokens(c);
	}

	try {
		await db.batch([
			db.insert(schema.tokenTransactions).values({
				id: nanoid(), userId, amount: -cost, type: "render", description: `Render (${resolution})`,
				projectId, operationKey: `render:${idempotencyKey}:debit`,
			}),
			db.insert(schema.renderJobs).values({
				id: jobId, userId, projectId, resolution, status: "queued", progress: 0,
				idempotencyKey, chargedTokens: cost, createdAt: now, updatedAt: now,
			}),
		]);
	} catch (error) {
		await db.update(schema.user).set({ tokens: sql`${schema.user.tokens} + ${cost}`, updatedAt: new Date() })
			.where(eq(schema.user.id, userId));
		throw error;
	}

	const queueMessage: RenderQueueMessage = { jobId, projectId, userId, resolution };
	try {
		await c.env.RENDER_QUEUE.send(queueMessage);
	} catch (error) {
		await db.batch([
			db.update(schema.renderJobs).set({ status: "failed", error: "Render could not be queued", refundedAt: Date.now(), updatedAt: Date.now() }).where(eq(schema.renderJobs.id, jobId)),
			db.update(schema.user).set({ tokens: sql`${schema.user.tokens} + ${cost}`, updatedAt: new Date() }).where(eq(schema.user.id, userId)),
			db.insert(schema.tokenTransactions).values({ id: nanoid(), userId, amount: cost, type: "refund", description: `Refund: render ${jobId} could not be queued`, projectId, operationKey: `render:${jobId}:refund` }),
		]);
		throw error;
	}

	// Initialize the RenderJobDO via the render worker's HTTP surface.
	try {
		await c.env.RENDER_SERVICE.fetch(`https://render/do/${jobId}/init`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ jobId, projectId, userId }),
		});
	} catch (e) {
		// Non-fatal: the queue consumer in apps/render will also (re)initialize
		// DO state when it picks up the message. Log and continue.
		console.error("RenderJobDO init failed", e);
	}

	const created = await db.select().from(schema.renderJobs).where(eq(schema.renderJobs.id, jobId)).get();
	return okJson(c, created, 202);
});

// ---------- GET /render-jobs/:id ----------
render.get("/render-jobs/:id", async (c) => {
	const userId = c.get("userId");
	const jobId = c.req.param("id");
	const db = getDb(c.env.DB);

	const row = await db
		.select()
		.from(schema.renderJobs)
		.where(and(eq(schema.renderJobs.id, jobId), eq(schema.renderJobs.userId, userId)))
		.get();
	if (!row) return Errors.notFound(c, "Render job not found");
	const publicJob = async (job: typeof row) => ({
		...job,
		videoUrl: job.videoUrl && !job.videoUrl.startsWith("http")
			? await presignGet(c.env, "renders", job.videoUrl)
			: job.videoUrl,
	});

	try {
		const res = await c.env.RENDER_SERVICE.fetch(`https://render/do/${jobId}/status`);
		if (res.ok) {
			const body = await res.json() as { data?: { jobId?: string; status?: string; progress?: number; videoUrl?: string; error?: string } };
			return okJson(c, await publicJob({
				...row,
				status: body.data?.status ?? row.status,
				progress: body.data?.progress ?? row.progress,
				videoUrl: body.data?.videoUrl ?? row.videoUrl,
				error: body.data?.error ?? row.error,
			}));
		}
	} catch (e) {
		console.error("RenderJobDO status fetch failed, falling back to D1", e);
	}

	// Fallback to the D1 row (updated by the queue consumer / DO progress pushes).
	return okJson(c, await publicJob(row));
});

// ---------- GET /render-jobs/:id/ws (WebSocket upgrade proxy) ----------
render.get("/render-jobs/:id/ws", async (c) => {
	const userId = c.get("userId");
	const jobId = c.req.param("id");
	const db = getDb(c.env.DB);

	const row = await db
		.select({ id: schema.renderJobs.id })
		.from(schema.renderJobs)
		.where(and(eq(schema.renderJobs.id, jobId), eq(schema.renderJobs.userId, userId)))
		.get();
	if (!row) return Errors.notFound(c, "Render job not found");

	if (c.req.header("upgrade")?.toLowerCase() !== "websocket") {
		return Errors.badRequest(c, "Expected WebSocket upgrade");
	}

	// Forward the upgrade request as-is to the render worker's DO route.
	const proxied = new Request(`https://render/do/${jobId}/ws`, c.req.raw);
	return c.env.RENDER_SERVICE.fetch(proxied);
});

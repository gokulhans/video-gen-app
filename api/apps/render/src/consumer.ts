/**
 * render-queue consumer.
 *
 * Flow per message: load project composition from D1 -> validate ->
 * DO+D1 status "starting" -> get container instance -> startAndWaitForPorts()
 * -> POST /render -> poll container GET /progress/:jobId, forwarding to the
 * RenderJobDO (every poll) and to D1 (on status change / 10% steps) ->
 * on success: mark render_jobs completed + notification + FCM push;
 * on failure: mark failed, refund render tokens, notification + FCM push.
 *
 * Retry semantics: failures during the "setup" phase (parsing the message,
 * loading/validating the composition, initializing the DO) are transient /
 * safe to retry — no tokens have been touched yet in this worker, so we call
 * `message.retry()`. Once the container has accepted a `/render` request we
 * are in the "committed" phase: any failure there is treated as terminal
 * (mark failed, refund tokens, notify, then `message.ack()`) because
 * re-running the same job could double-charge or double-render. Queue-level
 * `max_retries` + `dead_letter_queue` (render-dlq) catch poison messages that
 * can't even be parsed.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@app/db";
import * as schema from "@app/db/schema";
import { nanoid } from "nanoid";
import { RenderQueueMessage, RenderRequest, ProjectComposition } from "@app/shared";
import type { Env } from "./index";
import type { RendererContainer } from "./do";
import { sendFcmPush } from "./fcm";
import { stuckRenderCutoff } from "./reaper-policy";

const POLL_INTERVAL_MS = 3000;
const MAX_WAIT_MS = 15 * 60 * 1000; // 15 min ceiling per job
const SETUP_MAX_ATTEMPTS = 3;

type Db = ReturnType<typeof getDb>;

export async function handleQueueBatch(batch: MessageBatch<RenderQueueMessage>, env: Env): Promise<void> {
	for (const message of batch.messages) {
		await processMessage(message, env);
	}
}

async function processMessage(message: Message<RenderQueueMessage>, env: Env): Promise<void> {
	const db = getDb(env.DB);

	// ---------- Phase 0: parse (poison-message guard) ----------
	const parseResult = RenderQueueMessage.safeParse(message.body);
	if (!parseResult.success) {
		console.error("render-queue: invalid message body", message.body, parseResult.error.flatten());
		if (message.attempts >= SETUP_MAX_ATTEMPTS) {
			// Give up locally; queue's dead_letter_queue config also catches
			// messages that exhaust max_retries at the platform level.
			message.ack();
		} else {
			message.retry();
		}
		return;
	}
	const { jobId, projectId, userId, resolution } = parseResult.data;

	let composition: ProjectComposition;

	// ---------- Phase A: setup (safe to retry) ----------
	try {
		await doFetch(env, jobId, "/init", "POST", { jobId, projectId, userId });

		const project = await db.query.projects.findFirst({ where: eq(schema.projects.id, projectId) });
		if (!project) throw new Error(`Project ${projectId} not found`);
		if (!project.composition) throw new Error(`Project ${projectId} has no composition JSON`);

		composition = ProjectComposition.parse(project.composition);

		await db
			.update(schema.renderJobs)
			.set({ status: "starting", progress: 0, error: null, updatedAt: Date.now() })
			.where(eq(schema.renderJobs.id, jobId));

		await doFetch(env, jobId, "/progress", "POST", { status: "starting", progress: 0 });
	} catch (err) {
		console.error(`render-queue: setup failed for job ${jobId}`, err);
		if (message.attempts >= SETUP_MAX_ATTEMPTS) {
			await finalizeFailure(env, db, { jobId, projectId, userId, resolution }, toErrorMessage(err));
			message.ack();
		} else {
			message.retry();
		}
		return;
	}

	// ---------- Phase B: render (committed — no retry on failure) ----------
	try {
		const outputKey = `${userId}/renders/${jobId}.mp4`;
		const renderRequest = RenderRequest.parse({ jobId, composition, resolution, outputKey });

		const container = env.RENDERER.getByName(jobId) as unknown as RendererContainer & {
			fetch: (input: RequestInfo, init?: RequestInit) => Promise<Response>;
			startAndWaitForPorts: () => Promise<void>;
		};

		await container.startAndWaitForPorts();

		const startRes = await container.fetch("http://container/render", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(renderRequest),
		});
		if (!startRes.ok) {
			throw new Error(`Container /render rejected: ${startRes.status} ${await startRes.text()}`);
		}

		await doFetch(env, jobId, "/progress", "POST", { status: "rendering", progress: 0 });
		await db
			.update(schema.renderJobs)
			.set({ status: "rendering", updatedAt: Date.now() })
			.where(eq(schema.renderJobs.id, jobId));

		const result = await pollContainerProgress(container, jobId, env, db);

		if (result.status !== "completed" || !result.videoUrl) {
			throw new Error(result.error ?? "Render finished without success or videoUrl");
		}

		await onRenderSuccess(env, db, { jobId, projectId, userId }, result.videoUrl);
		message.ack();
	} catch (err) {
		console.error(`render-queue: render failed for job ${jobId}`, err);
		await finalizeFailure(env, db, { jobId, projectId, userId, resolution }, toErrorMessage(err));
		// Terminal — do not retry a committed render (avoids double token debit
		// / duplicate renders). Poison-message DLQ doesn't apply here since the
		// message parsed fine; this is a legitimate render outcome.
		message.ack();
	}
}

async function pollContainerProgress(
	container: { fetch: (input: RequestInfo, init?: RequestInit) => Promise<Response> },
	jobId: string,
	env: Env,
	db: Db,
): Promise<{ status: string; progress: number; videoUrl?: string; error?: string }> {
	const startedAt = Date.now();
	let lastReportedDecile = -1;
	let lastStatus = "";

	// eslint-disable-next-line no-constant-condition
	while (true) {
		if (Date.now() - startedAt > MAX_WAIT_MS) {
			return { status: "failed", progress: 0, error: "Render timed out" };
		}

		const res = await container.fetch(`http://container/progress/${jobId}`);
		if (!res.ok) {
			// container may not have registered the job yet; keep polling
			await sleep(POLL_INTERVAL_MS);
			continue;
		}
		const data = (await res.json()) as { status: string; progress: number; videoUrl?: string; error?: string };

		if (data.status !== lastStatus || Math.floor(data.progress / 10) !== lastReportedDecile) {
			await doFetch(env, jobId, "/progress", "POST", {
				status: data.status,
				progress: data.progress,
				error: data.error,
				videoUrl: data.videoUrl,
			});
			await db
				.update(schema.renderJobs)
				.set({ status: mapToRenderJobStatus(data.status), progress: data.progress, updatedAt: Date.now() })
				.where(eq(schema.renderJobs.id, jobId));
			lastStatus = data.status;
			lastReportedDecile = Math.floor(data.progress / 10);
		}

		if (data.status === "completed" || data.status === "failed") {
			return data;
		}

		await sleep(POLL_INTERVAL_MS);
	}
}

function mapToRenderJobStatus(containerStatus: string): "queued" | "rendering" | "completed" | "failed" {
	if (containerStatus === "completed") return "completed";
	if (containerStatus === "failed") return "failed";
	if (containerStatus === "queued" || containerStatus === "starting") return "queued";
	return "rendering";
}

async function onRenderSuccess(
	env: Env,
	db: Db,
	job: { jobId: string; projectId: string; userId: string },
	videoUrl: string,
): Promise<void> {
	const { jobId, projectId, userId } = job;

	const result = await db
		.update(schema.renderJobs)
		.set({ status: "completed", progress: 100, videoUrl, error: null, updatedAt: Date.now() })
		.where(and(eq(schema.renderJobs.id, jobId), sql`${schema.renderJobs.status} NOT IN ('completed', 'failed')`));
	const changes = (result as unknown as { meta?: { changes?: number } }).meta?.changes ?? 0;
	if (changes === 0) return;

	await doFetch(env, jobId, "/progress", "POST", { status: "completed", progress: 100, videoUrl });

	const project = await db.query.projects.findFirst({ where: eq(schema.projects.id, projectId) });

	await db.insert(schema.notifications).values({
		id: nanoid(),
		userId,
		type: "render_complete",
		title: "Your video is ready",
		message: project?.name ? `"${project.name}" finished rendering.` : "Your video finished rendering.",
		projectId,
		projectName: project?.name ?? null,
		downloadUrl: videoUrl,
		createdAt: Date.now(),
	});

	await notifyDevices(env, db, userId, {
		title: "Your video is ready",
		body: project?.name ? `"${project.name}" finished rendering.` : "Your video finished rendering.",
		data: { type: "render_complete", jobId, projectId, videoUrl },
	});
}

/**
 * Cron reaper: fail-and-refund render jobs stuck in queued/rendering for
 * longer than STUCK_AFTER_MS (container crash, lost message, etc.).
 */
export async function reapStuckJobs(env: Env): Promise<void> {
	const db = getDb(env.DB);
	const cutoff = stuckRenderCutoff(Date.now());
	const stuck = await db.query.renderJobs.findMany({
		where: (jobs, { and, inArray, lt }) => and(inArray(jobs.status, ["queued", "rendering"]), lt(jobs.updatedAt, cutoff)),
		limit: 25,
	});
	for (const job of stuck) {
		if (!job.projectId) continue;
		try {
			await finalizeFailure(
				env,
				db,
				{
					jobId: job.id,
					projectId: job.projectId,
					userId: job.userId,
					resolution: job.resolution === "1080p" ? "1080p" : "720p",
				},
				"Render timed out and was cancelled by the system.",
			);
		} catch (err) {
			console.error(`reaper: failed to finalize stuck job ${job.id}`, err);
		}
	}
}

async function finalizeFailure(
	env: Env,
	db: Db,
	job: { jobId: string; projectId: string; userId: string; resolution: "720p" | "1080p" },
	errorMessage: string,
): Promise<void> {
	const { jobId, projectId, userId, resolution } = job;

	const claimed = await db
		.update(schema.renderJobs)
		.set({ status: "failed", error: errorMessage, refundedAt: Date.now(), updatedAt: Date.now() })
		.where(and(
			eq(schema.renderJobs.id, jobId),
			isNull(schema.renderJobs.refundedAt),
			sql`${schema.renderJobs.status} NOT IN ('completed', 'failed')`,
		));
	const changes = (claimed as unknown as { meta?: { changes?: number } }).meta?.changes ?? 0;
	if (changes === 0) return;

	await doFetch(env, jobId, "/progress", "POST", { status: "failed", progress: 0, error: errorMessage });

	await refundRenderTokens(db, { userId, jobId, projectId });

	const project = await db.query.projects.findFirst({ where: eq(schema.projects.id, projectId) });

	await db.insert(schema.notifications).values({
		id: nanoid(),
		userId,
		type: "render_failed",
		title: "Render failed",
		message: project?.name
			? `"${project.name}" failed to render. Your tokens have been refunded.`
			: "Your render failed. Your tokens have been refunded.",
		projectId,
		projectName: project?.name ?? null,
		createdAt: Date.now(),
	});

	await notifyDevices(env, db, userId, {
		title: "Render failed",
		body: "Your tokens have been refunded — please try again.",
		data: { type: "render_failed", jobId, projectId },
	});
}

async function refundRenderTokens(
	db: Db,
	job: { userId: string; jobId: string; projectId: string },
): Promise<void> {
	const { userId, jobId, projectId } = job;
	const renderJob = await db.query.renderJobs.findFirst({ where: eq(schema.renderJobs.id, jobId) });
	const amount = renderJob?.chargedTokens ?? 0;
	if (amount <= 0) return;

	// Mirrors CONTRACTS.md's db.batch requirement for token ledger mutations:
	// credit balance + insert transaction row atomically.
	await db.batch([
		db
			.update(schema.user)
			.set({ tokens: sql`${schema.user.tokens} + ${amount}`, updatedAt: new Date() })
			.where(eq(schema.user.id, userId)),
		db.insert(schema.tokenTransactions).values({
			id: nanoid(),
			userId,
			amount,
			type: "refund",
			description: `Refund for failed render job ${jobId}`,
			projectId,
			operationKey: `render:${jobId}:refund`,
			createdAt: Date.now(),
		}),
	]);
}

async function notifyDevices(
	env: Env,
	db: Db,
	userId: string,
	push: { title: string; body: string; data: Record<string, string> },
): Promise<void> {
	try {
		const policy=await env.DB.prepare("SELECT u.email,COALESCE(p.push_enabled,1) push_enabled,COALESCE(p.email_enabled,0) email_enabled,COALESCE(p.render_updates,1) render_updates FROM user u LEFT JOIN notification_preferences p ON p.user_id=u.id WHERE u.id=?").bind(userId).first<{email:string;push_enabled:number;email_enabled:number;render_updates:number}>();
		if(!policy||policy.render_updates!==1)return;
		if(policy.push_enabled===1){const devices = await db.query.devices.findMany({ where: and(eq(schema.devices.userId, userId),isNull(schema.devices.disabledAt)) });await Promise.all(devices.map((d) => sendFcmPush(env, { token: d.fcmToken, title: push.title, body: push.body, data: push.data })));}
		if(policy.email_enabled===1&&policy.email){try{await env.EMAIL.send({to:policy.email,from:{email:env.EMAIL_FROM_ADDRESS,name:env.EMAIL_FROM_NAME},subject:push.title,text:push.body,html:`<p>${push.body.replace(/[&<>]/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[ch]!))}</p>`});}catch(error){console.error("render transactional email failed",error);}}
	} catch (err) {
		// Never let a notification delivery failure fail the render pipeline.
		console.error("notifyDevices failed", err);
	}
}

async function doFetch(env: Env, jobId: string, path: string, method: string, body?: unknown): Promise<void> {
	const id = env.RENDER_JOB_DO.idFromName(jobId);
	const stub = env.RENDER_JOB_DO.get(id) as unknown as { fetch: (input: RequestInfo, init?: RequestInit) => Promise<Response> };
	const res = await stub.fetch(`http://do-internal${path}`, {
		method,
		headers: body ? { "content-type": "application/json" } : undefined,
		body: body ? JSON.stringify(body) : undefined,
	});
	if (!res.ok && res.status !== 409) {
		console.error(`DO ${path} returned ${res.status} for job ${jobId}`);
	}
}

function toErrorMessage(err: unknown): string {
	if (err instanceof Error) return err.message;
	return String(err);
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

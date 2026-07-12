import { RenderJobDO, RendererContainer } from "./do";
import { handleQueueBatch, reapStuckJobs } from "./consumer";
import type { RenderQueueMessage } from "@app/shared";

export { RenderJobDO, RendererContainer };

export interface Env {
	DB: D1Database;
	ASSETS_BUCKET: R2Bucket;
	RENDERS_BUCKET: R2Bucket;
	RENDER_JOB_DO: DurableObjectNamespace;
	RENDERER: DurableObjectNamespace;

	// R2 S3-compatible credentials, forwarded into the Container as env vars
	// (secrets — set via `wrangler secret put`).
	R2_ACCOUNT_ID: string;
	R2_ACCESS_KEY_ID: string;
	R2_SECRET_ACCESS_KEY: string;
	R2_RENDERS_BUCKET_NAME: string;

	// Push notifications
	FCM_SERVICE_ACCOUNT_JSON: string;
	EMAIL: SendEmail;
	EMAIL_FROM_ADDRESS: string;
	EMAIL_FROM_NAME: string;
}

/**
 * This worker is invoked two ways:
 *  1. HTTP — `apps/api`'s RENDER_SERVICE service binding calls
 *     `/do/:jobId/*` to reach the RenderJobDO for status/WS proxying.
 *  2. Queue — `render-queue` messages trigger the render pipeline.
 */
export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);
		const match = url.pathname.match(/^\/do\/([^/]+)(\/.*)?$/);

		if (!match) {
			return new Response(JSON.stringify({ error: { code: "not_found", message: "Unknown route" } }), {
				status: 404,
				headers: { "content-type": "application/json" },
			});
		}

		const [, jobId, rest] = match;
		const id = env.RENDER_JOB_DO.idFromName(jobId);
		const stub = env.RENDER_JOB_DO.get(id);

		const doUrl = new URL(request.url);
		doUrl.pathname = rest && rest.length > 0 ? rest : "/status";

		return stub.fetch(new Request(doUrl, request));
	},

	async queue(batch: MessageBatch<RenderQueueMessage>, env: Env): Promise<void> {
		await handleQueueBatch(batch, env);
	},

	// Cron: stuck-job reaper (fails + refunds jobs idle past the timeout).
	async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
		ctx.waitUntil(reapStuckJobs(env));
	},
};

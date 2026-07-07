/**
 * Durable Objects for the render worker:
 *  - `RenderJobDO`  — per-job live state (progress/status/videoUrl/error),
 *    HTTP interface exactly per CONTRACTS.md, plus a hibernatable WebSocket
 *    endpoint that pushes RenderProgressMessage JSON on every update.
 *  - `RendererContainer` — the Container class wrapping the Remotion
 *    renderer Docker image (containers/renderer). One instance per render
 *    job via `env.RENDERER.getByName(jobId)`.
 */
import { Container } from "@cloudflare/containers";
import type { RenderProgressMessage } from "@app/shared";
import type { Env } from "./index";

interface JobState {
	jobId: string;
	projectId: string;
	userId: string;
	status: RenderProgressMessage["status"];
	progress: number;
	videoUrl?: string;
	error?: string;
	updatedAt: number;
}

const STATE_KEY = "state";

export class RenderJobDO implements DurableObject {
	state: DurableObjectState;
	env: Env;

	constructor(state: DurableObjectState, env: Env) {
		this.state = state;
		this.env = env;
	}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);

		if (request.method === "POST" && url.pathname === "/init") {
			return this.handleInit(request);
		}
		if (request.method === "POST" && url.pathname === "/progress") {
			return this.handleProgress(request);
		}
		if (request.method === "GET" && url.pathname === "/status") {
			return this.handleStatus();
		}
		if (request.method === "GET" && url.pathname === "/ws") {
			return this.handleWebSocketUpgrade(request);
		}

		return new Response(JSON.stringify({ error: { code: "not_found", message: "Unknown DO route" } }), {
			status: 404,
			headers: { "content-type": "application/json" },
		});
	}

	private async getState(): Promise<JobState | null> {
		return (await this.state.storage.get<JobState>(STATE_KEY)) ?? null;
	}

	private async handleInit(request: Request): Promise<Response> {
		const body = (await request.json()) as { jobId: string; projectId: string; userId: string };
		const existing = await this.getState();
		const next: JobState = {
			jobId: body.jobId,
			projectId: body.projectId,
			userId: body.userId,
			status: existing?.status ?? "queued",
			progress: existing?.progress ?? 0,
			videoUrl: existing?.videoUrl,
			error: existing?.error,
			updatedAt: Date.now(),
		};
		await this.state.storage.put(STATE_KEY, next);
		return Response.json({ data: next });
	}

	private async handleProgress(request: Request): Promise<Response> {
		const body = (await request.json()) as {
			progress: number;
			status: string;
			error?: string;
			videoUrl?: string;
		};
		const existing = await this.getState();
		if (!existing) {
			return new Response(JSON.stringify({ error: { code: "not_initialized", message: "DO has no state; call /init first" } }), {
				status: 409,
				headers: { "content-type": "application/json" },
			});
		}
		const next: JobState = {
			...existing,
			progress: body.progress,
			status: body.status as JobState["status"],
			error: body.error,
			videoUrl: body.videoUrl ?? existing.videoUrl,
			updatedAt: Date.now(),
		};
		await this.state.storage.put(STATE_KEY, next);
		this.broadcast(next);
		return Response.json({ data: next });
	}

	private async handleStatus(): Promise<Response> {
		const existing = await this.getState();
		if (!existing) {
			return new Response(JSON.stringify({ error: { code: "not_found", message: "Job not found" } }), {
				status: 404,
				headers: { "content-type": "application/json" },
			});
		}
		return Response.json({
			data: {
				jobId: existing.jobId,
				status: existing.status,
				progress: existing.progress,
				videoUrl: existing.videoUrl,
				error: existing.error,
			},
		});
	}

	private handleWebSocketUpgrade(request: Request): Response {
		if (request.headers.get("Upgrade") !== "websocket") {
			return new Response("Expected WebSocket upgrade", { status: 426 });
		}
		const pair = new WebSocketPair();
		const [client, server] = Object.values(pair) as [WebSocket, WebSocket];

		// Hibernatable WebSockets API — the DO can evict from memory between
		// messages/events; `acceptWebSocket` (not `.accept()`) enables that.
		this.state.acceptWebSocket(server);

		// Push current state immediately on connect.
		this.getState().then((existing) => {
			if (existing) {
				try {
					server.send(JSON.stringify(this.toProgressMessage(existing)));
				} catch {
					// socket may have already closed
				}
			}
		});

		return new Response(null, { status: 101, webSocket: client });
	}

	private toProgressMessage(s: JobState): RenderProgressMessage {
		return {
			jobId: s.jobId,
			status: s.status,
			progress: s.progress,
			videoUrl: s.videoUrl,
			error: s.error,
		};
	}

	private broadcast(s: JobState) {
		const payload = JSON.stringify(this.toProgressMessage(s));
		for (const ws of this.state.getWebSockets()) {
			try {
				ws.send(payload);
			} catch {
				// ignore broken sockets, they'll be cleaned up by the runtime
			}
		}
	}

	// Required hibernatable-WebSocket handlers (no-op: this DO is push-only,
	// clients don't send messages, but the runtime requires these to be
	// implemented for hibernation to work).
	async webSocketMessage(_ws: WebSocket, _message: string | ArrayBuffer): Promise<void> {
		// no-op — clients only listen
	}

	async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
		try {
			ws.close(code, reason);
		} catch {
			// already closed
		}
	}

	async webSocketError(_ws: WebSocket, _error: unknown): Promise<void> {
		// no-op
	}
}

/**
 * Container class for the Remotion renderer image (containers/renderer).
 * One instance per render job: `env.RENDERER.getByName(jobId)`.
 *
 * R2 credentials are forwarded as plain env vars because the container
 * runtime cannot access Worker bindings (R2 buckets) directly — it talks to
 * R2 over its S3-compatible API instead.
 */
export class RendererContainer extends Container<Env> {
	defaultPort = 8080;
	// Container sleeps (and is billed down) 10 minutes after last activity.
	sleepAfter = "10m";

	envVars: Record<string, string> = {};

	constructor(ctx: DurableObjectState, env: Env) {
		// Cast: @cloudflare/containers types its ctx via the `cloudflare:workers`
		// module while this project uses @cloudflare/workers-types ambients.
		super(ctx as never, env);
		this.envVars = {
			R2_ACCOUNT_ID: env.R2_ACCOUNT_ID ?? "",
			R2_ACCESS_KEY_ID: env.R2_ACCESS_KEY_ID ?? "",
			R2_SECRET_ACCESS_KEY: env.R2_SECRET_ACCESS_KEY ?? "",
			R2_RENDERS_BUCKET_NAME: env.R2_RENDERS_BUCKET_NAME ?? "renders",
		};
	}
}

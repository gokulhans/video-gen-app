import type { RenderQueueMessage } from "@app/shared";

/**
 * Cloudflare Worker bindings + secrets for the API worker.
 * Binding names MUST match CONTRACTS.md exactly.
 */
export interface Env {
	// Bindings (CONTRACTS.md)
	DB: D1Database;
	KV: KVNamespace;
	ASSETS_BUCKET: R2Bucket;
	RENDERS_BUCKET: R2Bucket;
	UPLOADS_BUCKET: R2Bucket;
	EXPORTS_BUCKET: R2Bucket;
	STREAM: StreamBinding;
	RENDER_QUEUE: Queue<RenderQueueMessage>;
	GENERATION_PIPELINE: Workflow;
	P_VIDEO_GENERATION: Workflow<{ jobId: string; userId: string }>;
	REGEN_IMAGE: Workflow;
	REGEN_VOICE: Workflow;
	REWRITE_SCRIPT: Workflow;
	DATA_EXPORT_WORKFLOW: Workflow<{ requestId: string; userId: string }>;
	ACCOUNT_DELETION_WORKFLOW: Workflow<{ requestId: string; userId: string; scheduledFor: number }>;
	RENDER_SERVICE: Fetcher;

	// Secrets (CONTRACTS.md)
	OPENAI_API_KEY: string;
	GEMINI_API_KEY: string;
	REPLICATE_API_TOKEN: string;
	FCM_SERVICE_ACCOUNT_JSON: string;
	EMAIL_API_KEY: string;
	BETTER_AUTH_SECRET: string;
	GOOGLE_CLIENT_ID: string;
	GOOGLE_CLIENT_SECRET: string;

	// Secrets NOT in CONTRACTS.md — required for R2 presigning + Play Billing.
	// See README.md "Deviations from CONTRACTS.md".
	R2_ACCOUNT_ID: string;
	R2_ACCESS_KEY_ID: string;
	R2_SECRET_ACCESS_KEY: string;
	GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: string;
	GOOGLE_PLAY_PACKAGE_NAME: string;
	/** Shared only with the pipeline Worker; signs private R2-to-Stream ingest URLs. */
	MEDIA_INGEST_SIGNING_SECRET: string;
	DELETION_TOMBSTONE_SECRET: string;
	PLAY_TOKEN_PACKS_JSON: string;

	// Env vars (CONTRACTS.md)
	AI_GATEWAY_BASE_URL: string;
	APP_BASE_URL: string;
	PLAYBACK_PROVIDER?: string;
	ALLOWED_ORIGINS?: string;
	/** Unique code shown in the Stream dashboard, without `customer-`. */
	/** Optional legacy Stream playback code. R2 is the default provider. */
	STREAM_CUSTOMER_CODE?: string;
}

export type Variables = {
	userId: string;
	requestId: string;
	session: { id: string; userId: string; token: string };
};

export type AppEnv = { Bindings: Env; Variables: Variables };

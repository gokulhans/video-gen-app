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
	RENDER_QUEUE: Queue<RenderQueueMessage>;
	GENERATION_PIPELINE: Workflow;
	REGEN_IMAGE: Workflow;
	REGEN_VOICE: Workflow;
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

	// Env vars (CONTRACTS.md)
	AI_GATEWAY_BASE_URL: string;
	APP_BASE_URL: string;
}

export type Variables = {
	userId: string;
	session: { id: string; userId: string; token: string };
};

export type AppEnv = { Bindings: Env; Variables: Variables };

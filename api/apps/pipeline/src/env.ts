/** Worker bindings + secrets/vars for the pipeline worker. Binding names per CONTRACTS.md.
 *  `Workflow` is an ambient global type provided by @cloudflare/workers-types. */
export interface Env {
  DB: D1Database;
  ASSETS_BUCKET: R2Bucket;

  GENERATION_PIPELINE: Workflow;
  REGEN_IMAGE: Workflow;
  REGEN_VOICE: Workflow;
  REWRITE_SCRIPT: Workflow;

  AI_GATEWAY_BASE_URL: string;
  APP_BASE_URL: string;

  OPENAI_API_KEY: string;
  GEMINI_API_KEY: string;
  REPLICATE_API_TOKEN: string;
  FCM_SERVICE_ACCOUNT_JSON: string;
}

/** Public URL for an object stored in ASSETS_BUCKET. Assumes the api worker exposes
 *  an asset-serving route (see CONTRACTS.md "assets" surface) at `${APP_BASE_URL}/assets/:key`. */
export function assetUrl(env: Env, key: string): string {
  const encodedKey = key.split("/").map(encodeURIComponent).join("/");
  return `${env.APP_BASE_URL.replace(/\/$/, "")}/assets/${encodedKey}`;
}

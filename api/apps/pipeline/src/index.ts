import type { Env } from "./env.js";

export { GenerationPipeline } from "./workflows/generation-pipeline.js";
export { PVideoGenerationWorkflow } from "./workflows/p-video-generation.js";
export { RegenerateSceneImage } from "./workflows/regenerate-scene-image.js";
export { RegenerateVoiceover } from "./workflows/regenerate-voiceover.js";
export { RewriteScript } from "./workflows/rewrite-script.js";
export { DataExportWorkflow, AccountDeletionWorkflow } from "./workflows/account-lifecycle.js";

/**
 * This worker exposes no public HTTP surface — it only hosts Workflow classes,
 * triggered by the api worker via the GENERATION_PIPELINE / P_VIDEO_GENERATION / REGEN_IMAGE / REGEN_VOICE
 * workflow bindings (see CONTRACTS.md). The fetch handler exists so `wrangler dev`
 * has something to serve and to make misconfigured direct requests obvious.
 */
export default {
  async fetch(): Promise<Response> {
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;

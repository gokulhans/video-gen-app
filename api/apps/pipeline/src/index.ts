import type { Env } from "./env.js";

export { GenerationPipeline } from "./workflows/generation-pipeline.js";
export { RegenerateSceneImage } from "./workflows/regenerate-scene-image.js";
export { RegenerateVoiceover } from "./workflows/regenerate-voiceover.js";

/**
 * This worker exposes no public HTTP surface — it only hosts Workflow classes,
 * triggered by the api worker via the GENERATION_PIPELINE / REGEN_IMAGE / REGEN_VOICE
 * workflow bindings (see CONTRACTS.md). The fetch handler exists so `wrangler dev`
 * has something to serve and to make misconfigured direct requests obvious.
 */
export default {
  async fetch(): Promise<Response> {
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;

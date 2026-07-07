import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@app/db";
import { ProjectComposition, Scene } from "@app/shared";
import type { Env } from "../env.js";
import { assetUrl } from "../env.js";
import { deductTokens, getTokenCost, refundTokens } from "../tokens.js";
import { replicateGenerateImage } from "../providers/replicate.js";

export const RegenerateSceneImageParams = z.object({
  projectId: z.string(),
  userId: z.string(),
  sceneId: z.string(),
  newPrompt: z.string().optional(),
});
export type RegenerateSceneImageParams = z.infer<typeof RegenerateSceneImageParams>;

export class RegenerateSceneImage extends WorkflowEntrypoint<Env, RegenerateSceneImageParams> {
  async run(event: WorkflowEvent<RegenerateSceneImageParams>, step: WorkflowStep) {
    const { projectId, userId, sceneId, newPrompt } = RegenerateSceneImageParams.parse(event.payload);
    const env = this.env;

    const imageCost = await step.do("deduct-tokens", async () => {
      const db = getDb(env.DB);
      const cost = await getTokenCost(db, "image_generation");
      const result = await deductTokens(db, {
        userId,
        amount: cost,
        type: "image_generation",
        description: `Regenerate scene image ${sceneId} for project ${projectId}`,
        projectId,
      });
      if (!result.ok) {
        throw new NonRetryableError(
          `Insufficient tokens: balance ${result.balance}, required ${cost}`,
          "InsufficientTokens"
        );
      }
      return cost;
    });

    try {
      const { updatedScene, composition } = await step.do(
        "regenerate-image",
        { retries: { limit: 3, delay: "10 seconds", backoff: "exponential" }, timeout: "3 minutes" },
        async () => {
          const db = getDb(env.DB);
          const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).limit(1);
          if (!project) throw new NonRetryableError(`Project ${projectId} not found`, "ProjectNotFound");

          const scenes = (project.scenes as Scene[] | null) ?? [];
          const idx = scenes.findIndex((s) => s.id === sceneId);
          if (idx === -1) throw new NonRetryableError(`Scene ${sceneId} not found in project ${projectId}`, "SceneNotFound");

          const scene = scenes[idx];
          const prompt = newPrompt || scene.imagePrompt;
          const imageBytes = await replicateGenerateImage(env, { prompt, aspectRatio: (project.ratio as "9:16" | "1:1" | "16:9") ?? "9:16" });
          const key = `${userId}/${projectId}/scenes/${sceneId}.webp`;
          await env.ASSETS_BUCKET.put(key, imageBytes, { httpMetadata: { contentType: "image/webp" } });

          const newScene: Scene = { ...scene, imagePrompt: prompt, imageUrl: assetUrl(env, key), imageStatus: "ready" };
          const newScenes = [...scenes];
          newScenes[idx] = newScene;

          const existingComposition = project.composition as ProjectComposition | null;
          const composition = existingComposition
            ? ProjectComposition.parse({ ...existingComposition, scenes: newScenes })
            : null;

          await db
            .update(schema.projects)
            .set({
              scenes: newScenes,
              ...(composition ? { composition } : {}),
              updatedAt: Date.now(),
            })
            .where(eq(schema.projects.id, projectId));

          return { updatedScene: newScene, composition };
        }
      );

      return { projectId, scene: updatedScene, composition };
    } catch (err) {
      await step.do("refund-tokens", async () => {
        const db = getDb(env.DB);
        await refundTokens(db, {
          userId,
          amount: imageCost,
          description: `Refund: scene image regeneration failed for project ${projectId}`,
          projectId,
        });
      });
      throw err;
    }
  }
}

import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@app/db";
import { ProjectComposition, Scene } from "@app/shared";
import type { Env } from "../env.js";
import { assetUrl } from "../env.js";
import { deductTokens, getTokenCost, refundTokens } from "../tokens.js";
import { createFluxPrediction, downloadReplicateImage, waitForFluxPrediction } from "../providers/replicate.js";

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
        operationKey: `regen-image:${event.instanceId}:debit`,
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
      const source = await step.do("load-scene", async () => {
          const db = getDb(env.DB);
          const [project] = await db
            .select()
            .from(schema.projects)
            .where(and(eq(schema.projects.id, projectId), eq(schema.projects.userId, userId)))
            .limit(1);
          if (!project) throw new NonRetryableError(`Project ${projectId} not found`, "ProjectNotFound");

          const scenes = (project.scenes as Scene[] | null) ?? [];
          const idx = scenes.findIndex((s) => s.id === sceneId);
          if (idx === -1) throw new NonRetryableError(`Scene ${sceneId} not found in project ${projectId}`, "SceneNotFound");

          const scene = scenes[idx];
          const prompt = newPrompt || scene.imagePrompt;
          return { scene, prompt, ratio: (project.ratio as "9:16" | "1:1" | "16:9") ?? "9:16" };
      });

      const prediction = await step.do(
        "create-image-prediction",
        { retries: { limit: 0, delay: "1 second" }, timeout: "30 seconds" },
        () => createFluxPrediction(env, { prompt: source.prompt, aspectRatio: source.ratio }),
      );
      const outputUrl = await step.do(
        "wait-image-prediction",
        { retries: { limit: 3, delay: "5 seconds", backoff: "exponential" }, timeout: "2 minutes" },
        () => waitForFluxPrediction(env, prediction),
      );
      const key = `${userId}/${projectId}/scenes/${sceneId}.webp`;
      await step.do(
        "store-image",
        { retries: { limit: 3, delay: "3 seconds", backoff: "exponential" }, timeout: "1 minute" },
        async () => {
          const imageBytes = await downloadReplicateImage(env, outputUrl);
          const key = `${userId}/${projectId}/scenes/${sceneId}.webp`;
          await env.ASSETS_BUCKET.put(key, imageBytes, { httpMetadata: { contentType: "image/webp" } });
        },
      );

      const { updatedScene, composition } = await step.do("commit-image", async () => {
          const db = getDb(env.DB);
          const [project] = await db
            .select()
            .from(schema.projects)
            .where(and(eq(schema.projects.id, projectId), eq(schema.projects.userId, userId)))
            .limit(1);
          if (!project) throw new NonRetryableError(`Project ${projectId} not found`, "ProjectNotFound");
          const scenes = (project.scenes as Scene[] | null) ?? [];
          const idx = scenes.findIndex((s) => s.id === sceneId);
          if (idx === -1) throw new NonRetryableError(`Scene ${sceneId} not found in project ${projectId}`, "SceneNotFound");
          const newScene: Scene = { ...scenes[idx], imagePrompt: source.prompt, imageUrl: assetUrl(env, key), imageStatus: "ready" };
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
      });

      return { projectId, scene: updatedScene, composition };
    } catch (err) {
      await step.do("refund-tokens", async () => {
        const db = getDb(env.DB);
        await refundTokens(db, {
          userId,
          amount: imageCost,
          description: `Refund: scene image regeneration failed for project ${projectId}`,
          operationKey: `regen-image:${event.instanceId}:refund`,
          projectId,
        });
      });
      throw err;
    }
  }
}

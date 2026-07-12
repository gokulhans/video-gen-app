import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb, schema } from "@app/db";
import { GenerationParams, Scene, ProjectComposition, WordTimestamp } from "@app/shared";
import type { Env } from "../env.js";
import { assetUrl } from "../env.js";
import { deductTokens, getTokenCost, refundTokens } from "../tokens.js";
import { openaiChatCompletion, openaiTextToSpeech, openaiWordTimestamps } from "../providers/openai.js";
import { geminiGenerateText, geminiTextToSpeech } from "../providers/gemini.js";
import { createFluxPrediction, downloadReplicateImage, waitForFluxPrediction } from "../providers/replicate.js";
import { sendFcmPush } from "../providers/fcm.js";

const SCRIPT_RETRIES = { limit: 3, delay: "5 seconds", backoff: "exponential" } as const;
const VOICE_RETRIES = { limit: 3, delay: "10 seconds", backoff: "exponential" } as const;
const TIMESTAMPS_RETRIES = { limit: 2, delay: "5 seconds", backoff: "exponential" } as const;
const SCENES_RETRIES = { limit: 3, delay: "5 seconds", backoff: "exponential" } as const;

/** Plain, fully-serializable summary of a template row (JSON columns are typed `unknown`
 *  by drizzle, which Workflows' Serializable<T> constraint rejects — captionStyle is
 *  carried through as a JSON string instead and parsed only where it's consumed directly,
 *  never returned across a step.do boundary). */
type TemplateSummary = {
  scriptPromptPreset: string;
  imageStylePreset: string;
  musicTrackUrl: string | null;
  captionStyleJson: string | null;
};
type BrandRow = typeof schema.brands.$inferSelect;

/** Group whisper word timestamps into ~targetSec-second scene buckets. */
function groupWordsIntoScenes(words: WordTimestamp[], targetSec = 4): Array<{ text: string; start: number; end: number }> {
  if (words.length === 0) return [];
  const groups: Array<{ text: string; start: number; end: number }> = [];
  let bucket: WordTimestamp[] = [];
  let bucketStart = words[0].start;

  for (const w of words) {
    bucket.push(w);
    if (w.end - bucketStart >= targetSec) {
      groups.push({ text: bucket.map((b) => b.word).join(" ").trim(), start: bucketStart, end: w.end });
      bucket = [];
      bucketStart = w.end;
    }
  }
  if (bucket.length > 0) {
    groups.push({ text: bucket.map((b) => b.word).join(" ").trim(), start: bucketStart, end: bucket[bucket.length - 1].end });
  }
  return groups;
}

function buildScriptPrompt(template: TemplateSummary, params: { topic: string; details: string; language: string; durationSec: number }): string {
  return `${template.scriptPromptPreset}

TOPIC: "${params.topic}"
ADDITIONAL DETAILS: "${params.details || "none"}"
TARGET LENGTH: approximately ${params.durationSec} seconds when read aloud
LANGUAGE: ${params.language}

Output ONLY the final voiceover script — no titles, scene markers, speaker labels, or markdown.`;
}

async function markProjectFailed(env: Env, projectId: string, userId: string, error: string) {
  console.error(JSON.stringify({ event: "generation_failed", projectId, error }));
  const db = getDb(env.DB);
  await db
    .update(schema.projects)
    .set({
      generationStatus: "failed",
      generationStage: "failed",
      generationError: "Video generation failed. Your tokens were refunded.",
      updatedAt: Date.now(),
    })
    .where(eq(schema.projects.id, projectId));
  // Surface the error via a notification row so the app can show it.
  await db.insert(schema.notifications).values({
    id: nanoid(),
    userId,
    type: "system",
    title: "Video generation failed",
    message: "Video generation failed. Your tokens were refunded. Please try again.",
    projectId,
  });
}

export class GenerationPipeline extends WorkflowEntrypoint<Env, GenerationParams> {
  async run(event: WorkflowEvent<GenerationParams>, step: WorkflowStep) {
    const params = GenerationParams.parse(event.payload);
    const { projectId, userId, templateId, brandId, topic, details, language, durationSec, voice } = params;
    const env = this.env;

    // ---------- 1. deduct-tokens ----------
    const costs = await step.do("deduct-tokens", async () => {
      const db = getDb(env.DB);
      const scriptCost = await getTokenCost(db, "script_generation");
      const voiceCost = await getTokenCost(db, "voice_generation");
      const perImageCost = await getTokenCost(db, "image_generation");
      const estimatedScenes = Math.max(1, Math.round(durationSec / 4));
      const imagesCost = perImageCost * estimatedScenes;
      const total = scriptCost + voiceCost + imagesCost;

      const result = await deductTokens(db, {
        userId,
        amount: total,
        type: "script_generation",
        description: `Video generation for project ${projectId}`,
        operationKey: `generation:${event.instanceId}:debit`,
        projectId,
      });

      if (!result.ok) {
        await db
          .update(schema.projects)
          .set({ generationStatus: "failed", updatedAt: Date.now() })
          .where(eq(schema.projects.id, projectId));
        throw new NonRetryableError(
          `Insufficient tokens: balance ${result.balance}, required ${total}`,
          "InsufficientTokens"
        );
      }

      await db
        .update(schema.projects)
        .set({ generationStatus: "running", updatedAt: Date.now() })
        .where(eq(schema.projects.id, projectId));

      return { scriptCost, voiceCost, perImageCost, estimatedScenes, total };
    });

    try {
      // ---------- 2. load-template ----------
      const template: TemplateSummary = await step.do("load-template", async () => {
        const db = getDb(env.DB);
        const [row] = await db.select().from(schema.templates).where(eq(schema.templates.id, templateId)).limit(1);
        if (!row) throw new NonRetryableError(`Template ${templateId} not found`, "TemplateNotFound");
        return {
          scriptPromptPreset: row.scriptPromptPreset,
          imageStylePreset: row.imageStylePreset,
          musicTrackUrl: row.musicTrackUrl,
          captionStyleJson: row.captionStyle ? JSON.stringify(row.captionStyle) : null,
        };
      });

      // ---------- 3. generate-script ----------
      const script = await step.do(
        "generate-script",
        { retries: SCRIPT_RETRIES, timeout: "2 minutes" },
        async () => {
          const prompt = buildScriptPrompt(template, { topic, details, language, durationSec });
          try {
            return await openaiChatCompletion(env, { user: prompt, temperature: 0.7, maxTokens: 800 });
          } catch (err) {
            console.error("OpenAI script generation failed, falling back to Gemini:", err);
            return await geminiGenerateText(env, { user: prompt, temperature: 0.7 });
          }
        }
      );
      await step.do("progress-voice", async () => {
        await getDb(env.DB).update(schema.projects).set({ generationStage: "voice", generationProgress: 20, updatedAt: Date.now() }).where(eq(schema.projects.id, projectId));
      });

      // ---------- 4. generate-voiceover ----------
      const geminiVoice = voice.startsWith("gemini:");
      const voiceoverKey = `${userId}/${projectId}/voiceover.${geminiVoice ? "wav" : "mp3"}`;
      await step.do("generate-voiceover", { retries: VOICE_RETRIES, timeout: "3 minutes" }, async () => {
        const audio = geminiVoice
          ? await geminiTextToSpeech(env, { text: script, voiceName: voice.slice("gemini:".length) })
          : await openaiTextToSpeech(env, { text: script, voice });
        await env.ASSETS_BUCKET.put(voiceoverKey, audio, {
          httpMetadata: { contentType: geminiVoice ? "audio/wav" : "audio/mpeg" },
        });
        return { bytes: audio.byteLength };
      });
      const voiceoverUrl = assetUrl(env, voiceoverKey);
      await step.do("progress-captions", async () => {
        await getDb(env.DB).update(schema.projects).set({ generationStage: "captions", generationProgress: 40, updatedAt: Date.now() }).where(eq(schema.projects.id, projectId));
      });

      // ---------- 5. generate-timestamps ----------
      const words: WordTimestamp[] = await step.do(
        "generate-timestamps",
        { retries: TIMESTAMPS_RETRIES, timeout: "2 minutes" },
        async () => {
          const audioObj = await env.ASSETS_BUCKET.get(voiceoverKey);
          if (!audioObj) throw new Error("Voiceover object missing from R2 after upload");
          const audioBuffer = await audioObj.arrayBuffer();
          // Replicate's current openai/whisper schema does not guarantee word-level
          // timestamps. Keep one schema-verified source instead of silently falling
          // back to an incompatible paid prediction.
          return openaiWordTimestamps(env, audioBuffer);
        }
      );

      // ---------- 6. build-scenes ----------
      const scenes: Scene[] = await step.do(
        "build-scenes",
        { retries: SCENES_RETRIES, timeout: "2 minutes" },
        async () => {
          const groups = groupWordsIntoScenes(words, 4);
          if (groups.length === 0) throw new Error("No word timestamps available to build scenes");

          const listForPrompt = groups.map((g, i) => `${i + 1}. ${g.text}`).join("\n");
          const prompt = `${template.imageStylePreset}

For each numbered scene below, write ONE concise, visually rich text-to-image prompt (for the 'flux-schnell' model) that matches the style above and depicts that scene's content.
Respond as a JSON object: {"prompts": ["prompt for scene 1", "prompt for scene 2", ...]} with exactly ${groups.length} entries, in order. No other text.

SCENES:
${listForPrompt}`;

          let imagePrompts: string[];
          try {
            const raw = await openaiChatCompletion(env, { user: prompt, temperature: 0.6, jsonMode: true });
            const parsed = JSON.parse(raw) as { prompts?: string[] } | string[];
            imagePrompts = Array.isArray(parsed) ? parsed : parsed.prompts ?? [];
          } catch (err) {
            console.error("Image-prompt generation failed, using scene text as fallback prompt:", err);
            imagePrompts = groups.map((g) => `${template.imageStylePreset}: ${g.text}`);
          }

          return groups.map((g, i) =>
            Scene.parse({
              id: nanoid(8),
              order: i,
              text: g.text,
              start: g.start,
              end: g.end,
              imagePrompt: imagePrompts[i] ?? `${template.imageStylePreset}: ${g.text}`,
              imageUrl: null,
              imageStatus: "pending",
            })
          );
        }
      );
      await step.do("progress-images", async () => {
        await getDb(env.DB).update(schema.projects).set({ generationStage: "images", generationProgress: 60, updatedAt: Date.now() }).where(eq(schema.projects.id, projectId));
      });

      // ---------- 7. per-scene images, capped at four paid predictions ----------
      // Prediction creation, polling, and persistence are separate durable steps.
      // A storage retry therefore reuses the same provider result instead of paying
      // for another prediction.
      const sceneResults: Scene[] = [];
      const imageConcurrency = 4;
      for (let offset = 0; offset < scenes.length; offset += imageConcurrency) {
        const chunk = scenes.slice(offset, offset + imageConcurrency);
        const predictions = await Promise.all(
          chunk.map((scene) =>
            step.do(
              `image-create-${scene.id}`,
              { retries: { limit: 0, delay: "1 second" }, timeout: "30 seconds" },
              () => createFluxPrediction(env, { prompt: scene.imagePrompt, aspectRatio: "9:16" }),
            ),
          ),
        );
        const outputUrls = await Promise.all(
          predictions.map((prediction, index) =>
            step.do(
              `image-wait-${chunk[index].id}`,
              { retries: { limit: 3, delay: "5 seconds", backoff: "exponential" }, timeout: "2 minutes" },
              () => waitForFluxPrediction(env, prediction),
            ),
          ),
        );
        const persisted = await Promise.all(
          outputUrls.map((outputUrl, index) => {
            const scene = chunk[index];
            return step.do(
              `image-store-${scene.id}`,
              { retries: { limit: 3, delay: "3 seconds", backoff: "exponential" }, timeout: "1 minute" },
              async () => {
                const imageBytes = await downloadReplicateImage(env, outputUrl);
                const key = `${userId}/${projectId}/scenes/${scene.id}.webp`;
                await env.ASSETS_BUCKET.put(key, imageBytes, { httpMetadata: { contentType: "image/webp" } });
                return { ...scene, imageUrl: assetUrl(env, key), imageStatus: "ready" as const };
              },
            );
          }),
        );
        sceneResults.push(...persisted);
      }

      // ---------- 8. assemble ----------
      await step.do("assemble", async () => {
        const db = getDb(env.DB);
        let brand: BrandRow | undefined;
        if (brandId) {
          const [row] = await db
            .select()
            .from(schema.brands)
            .where(and(eq(schema.brands.id, brandId), eq(schema.brands.userId, userId)))
            .limit(1);
          brand = row;
        }

        const captionStyle = template.captionStyleJson ? JSON.parse(template.captionStyleJson) : null;
        const composition = ProjectComposition.parse({
          durationSec,
          language,
          script,
          voice,
          voiceoverUrl,
          musicUrl: template.musicTrackUrl ?? null,
          scenes: sceneResults,
          words,
          ...(captionStyle ? { captions: captionStyle } : {}),
          brand: brand
            ? {
                logoUrl: brand.logoUrl ?? null,
                primaryColor: brand.primaryColor ?? null,
                phone: brand.phone ?? null,
                website: brand.website ?? null,
                watermark: brand.watermark,
              }
            : {},
        });

        await db
          .update(schema.projects)
          .set({
            script,
            voiceoverUrl,
            timestamps: words,
            scenes: sceneResults,
            composition,
            captionConfig: composition.captions,
            generationStatus: "complete",
            generationStage: "done",
            generationProgress: 100,
            generationError: null,
            updatedAt: Date.now(),
          })
          .where(eq(schema.projects.id, projectId));
      });

      // ---------- 9. notify ----------
      await step.do("notify", async () => {
        const db = getDb(env.DB);
        await db.insert(schema.notifications).values({
          id: nanoid(),
          userId,
          type: "generation_complete",
          title: "Your video draft is ready",
          message: "Script, voiceover, and scenes have been generated. Open the project to review.",
          projectId,
        });

        const deviceRows = await db
          .select({ fcmToken: schema.devices.fcmToken })
          .from(schema.devices)
          .where(eq(schema.devices.userId, userId));

        const result = await sendFcmPush(env.FCM_SERVICE_ACCOUNT_JSON, deviceRows.map((d) => d.fcmToken), {
          title: "Your video draft is ready",
          body: "Tap to review your generated scenes.",
          data: { projectId, type: "generation_complete" },
        });
        return result;
      });

      return { projectId, script, voiceoverUrl, scenes: sceneResults };
    } catch (err) {
      // ---------- compensation: refund + mark failed ----------
      const message = err instanceof Error ? err.message : String(err);
      await step.do("refund-tokens", async () => {
        const db = getDb(env.DB);
        await refundTokens(db, {
          userId,
          amount: costs.total,
          description: `Refund: generation failed for project ${projectId}`,
          operationKey: `generation:${event.instanceId}:refund`,
          projectId,
        });
      });
      await step.do("mark-failed", async () => {
        await markProjectFailed(env, projectId, userId, message);
      });
      throw err;
    }
  }
}

import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@app/db";
import { ProjectComposition, WordTimestamp } from "@app/shared";
import type { Env } from "../env.js";
import { assetUrl } from "../env.js";
import { deductTokens, getTokenCost, refundTokens } from "../tokens.js";
import { openaiTextToSpeech, openaiWordTimestamps } from "../providers/openai.js";
import { geminiTextToSpeech } from "../providers/gemini.js";
import { replicateWordTimestamps } from "../providers/replicate.js";

export const RegenerateVoiceoverParams = z.object({
  projectId: z.string(),
  userId: z.string(),
  voice: z.string(),
});
export type RegenerateVoiceoverParams = z.infer<typeof RegenerateVoiceoverParams>;

export class RegenerateVoiceover extends WorkflowEntrypoint<Env, RegenerateVoiceoverParams> {
  async run(event: WorkflowEvent<RegenerateVoiceoverParams>, step: WorkflowStep) {
    const { projectId, userId, voice } = RegenerateVoiceoverParams.parse(event.payload);
    const env = this.env;

    const voiceCost = await step.do("deduct-tokens", async () => {
      const db = getDb(env.DB);
      const cost = await getTokenCost(db, "voice_generation");
      const result = await deductTokens(db, {
        userId,
        amount: cost,
        type: "voice_generation",
        description: `Regenerate voiceover for project ${projectId}`,
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
      const script = await step.do("load-script", async () => {
        const db = getDb(env.DB);
        const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).limit(1);
        if (!project || !project.script) {
          throw new NonRetryableError(`Project ${projectId} has no script to voice`, "ScriptMissing");
        }
        return project.script;
      });

      const voiceoverKey = `${userId}/${projectId}/voiceover.mp3`;
      await step.do("regenerate-voiceover", { retries: { limit: 3, delay: "10 seconds", backoff: "exponential" }, timeout: "3 minutes" }, async () => {
        const audio = voice.startsWith("gemini:")
          ? await geminiTextToSpeech(env, { text: script, voiceName: voice.slice("gemini:".length) })
          : await openaiTextToSpeech(env, { text: script, voice });
        await env.ASSETS_BUCKET.put(voiceoverKey, audio, { httpMetadata: { contentType: "audio/mpeg" } });
      });
      const voiceoverUrl = assetUrl(env, voiceoverKey);

      const words: WordTimestamp[] = await step.do(
        "regenerate-timestamps",
        { retries: { limit: 2, delay: "5 seconds", backoff: "exponential" }, timeout: "2 minutes" },
        async () => {
          const audioObj = await env.ASSETS_BUCKET.get(voiceoverKey);
          if (!audioObj) throw new Error("Voiceover object missing from R2 after upload");
          const audioBuffer = await audioObj.arrayBuffer();
          try {
            return await openaiWordTimestamps(env, audioBuffer);
          } catch (err) {
            console.error("OpenAI Whisper failed, falling back to Replicate:", err);
            return await replicateWordTimestamps(env, { audioUrl: voiceoverUrl });
          }
        }
      );

      const composition = await step.do("update-composition", async () => {
        const db = getDb(env.DB);
        const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).limit(1);
        const existingComposition = project?.composition as ProjectComposition | null;
        const nextComposition = existingComposition
          ? ProjectComposition.parse({ ...existingComposition, voice, voiceoverUrl, words })
          : null;

        await db
          .update(schema.projects)
          .set({
            voice,
            voiceoverUrl,
            timestamps: words,
            ...(nextComposition ? { composition: nextComposition } : {}),
            updatedAt: Date.now(),
          })
          .where(eq(schema.projects.id, projectId));

        return nextComposition;
      });

      return { projectId, voiceoverUrl, words, composition };
    } catch (err) {
      await step.do("refund-tokens", async () => {
        const db = getDb(env.DB);
        await refundTokens(db, {
          userId,
          amount: voiceCost,
          description: `Refund: voiceover regeneration failed for project ${projectId}`,
          projectId,
        });
      });
      throw err;
    }
  }
}

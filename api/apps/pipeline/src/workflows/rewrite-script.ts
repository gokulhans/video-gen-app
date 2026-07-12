import { WorkflowEntrypoint, WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@app/db";
import { ProjectComposition } from "@app/shared";
import type { Env } from "../env.js";
import { deductTokens, getTokenCost, refundTokens } from "../tokens.js";
import { openaiChatCompletion } from "../providers/openai.js";

export const RewriteScriptParams = z.object({
  projectId: z.string(),
  userId: z.string(),
  instruction: z.string().trim().max(1_000).optional(),
});
export type RewriteScriptParams = z.infer<typeof RewriteScriptParams>;

export class RewriteScript extends WorkflowEntrypoint<Env, RewriteScriptParams> {
  async run(event: WorkflowEvent<RewriteScriptParams>, step: WorkflowStep) {
    const { projectId, userId, instruction } = RewriteScriptParams.parse(event.payload);
    const env = this.env;
    const cost = await step.do("deduct-tokens", async () => {
      const db = getDb(env.DB);
      const amount = await getTokenCost(db, "script_rewrite");
      const result = await deductTokens(db, {
        userId, amount, type: "script_rewrite", projectId,
        description: `Rewrite script for project ${projectId}`,
        operationKey: `rewrite-script:${event.instanceId}:debit`,
      });
      if (!result.ok) throw new NonRetryableError("Insufficient tokens", "InsufficientTokens");
      return amount;
    });

    try {
      const source = await step.do("load-script", async () => {
        const project = await getDb(env.DB).select().from(schema.projects)
          .where(and(eq(schema.projects.id, projectId), eq(schema.projects.userId, userId))).get();
        if (!project?.script || !project.composition) {
          throw new NonRetryableError("Project has no generated script", "ScriptMissing");
        }
        return { script: project.script, composition: ProjectComposition.parse(project.composition) };
      });
      const script = await step.do(
        "rewrite-script",
        { retries: { limit: 2, delay: "5 seconds", backoff: "exponential" }, timeout: "2 minutes" },
        () => openaiChatCompletion(env, {
          system: "Rewrite the supplied video voiceover script. Output only the final script, with no markdown or commentary.",
          user: `INSTRUCTION: ${instruction || "Make the script clearer, more engaging, and concise."}\n\nSCRIPT:\n${source.script}`,
          temperature: 0.6,
          maxTokens: 1_000,
        }),
      );
      return step.do("commit-script", async () => {
        const composition = ProjectComposition.parse({ ...source.composition, script });
        await getDb(env.DB).update(schema.projects).set({ script, composition, updatedAt: Date.now() })
          .where(and(eq(schema.projects.id, projectId), eq(schema.projects.userId, userId)));
        return composition;
      });
    } catch (error) {
      await step.do("refund-tokens", async () => {
        await refundTokens(getDb(env.DB), {
          userId, amount: cost, projectId,
          description: `Refund: script rewrite failed for project ${projectId}`,
          operationKey: `rewrite-script:${event.instanceId}:refund`,
        });
      });
      throw error;
    }
  }
}

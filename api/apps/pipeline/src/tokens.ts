import { and, eq, gte, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb, schema } from "@app/db";
import { DEFAULT_TOKEN_COSTS } from "@app/shared";

export type Db = ReturnType<typeof getDb>;

/** Default token costs, used when the `token_costs` table has no active row for an action. */
/** Look up the active cost for a token action, falling back to defaults. */
export async function getTokenCost(db: Db, action: string): Promise<number> {
  const [row] = await db
    .select({ cost: schema.tokenCosts.cost })
    .from(schema.tokenCosts)
    .where(and(eq(schema.tokenCosts.action, action), eq(schema.tokenCosts.isActive, true)))
    .limit(1);
  return row?.cost ?? DEFAULT_TOKEN_COSTS[action as keyof typeof DEFAULT_TOKEN_COSTS] ?? 0;
}

export type DeductResult = { ok: true } | { ok: false; balance: number };

/**
 * Atomic token deduction using db.batch: conditional UPDATE (tokens -= amount WHERE tokens >= amount)
 * + an insert of the ledger row. 0 affected rows on the update means insufficient balance.
 */
export async function deductTokens(
  db: Db,
  params: { userId: string; amount: number; type: string; description: string; operationKey: string; projectId?: string | null }
): Promise<DeductResult> {
  const { userId, amount, type, description, operationKey, projectId = null } = params;
  if (amount <= 0) return { ok: true };

  const [existing] = await db
    .select({ id: schema.tokenTransactions.id })
    .from(schema.tokenTransactions)
    .where(eq(schema.tokenTransactions.operationKey, operationKey))
    .limit(1);
  if (existing) return { ok: true };

  const updateResult = await db
    .update(schema.user)
    .set({ tokens: sql`${schema.user.tokens} - ${amount}`, updatedAt: new Date() })
    .where(and(eq(schema.user.id, userId), gte(schema.user.tokens, amount)));

  const changes = (updateResult as unknown as { meta?: { changes?: number } }).meta?.changes ?? 0;
  if (changes === 0) {
    const [row] = await db.select({ tokens: schema.user.tokens }).from(schema.user).where(eq(schema.user.id, userId)).limit(1);
    return { ok: false, balance: row?.tokens ?? 0 };
  }

  try {
    await db.insert(schema.tokenTransactions).values({
      id: nanoid(),
      userId,
      amount: -amount,
      type,
      description,
      projectId,
      operationKey,
    });
  } catch (error) {
    // Keep balance and ledger coherent if the durable ledger write fails.
    await db
      .update(schema.user)
      .set({ tokens: sql`${schema.user.tokens} + ${amount}`, updatedAt: new Date() })
      .where(eq(schema.user.id, userId));
    throw error;
  }
  return { ok: true };
}

/** Compensating credit — used on refunds when a paid-for step never completed. */
export async function refundTokens(
  db: Db,
  params: { userId: string; amount: number; description: string; operationKey: string; projectId?: string | null }
): Promise<void> {
  const { userId, amount, description, operationKey, projectId = null } = params;
  if (amount <= 0) return;

  const [existing] = await db
    .select({ id: schema.tokenTransactions.id })
    .from(schema.tokenTransactions)
    .where(eq(schema.tokenTransactions.operationKey, operationKey))
    .limit(1);
  if (existing) return;

  await db
      .update(schema.user)
      .set({ tokens: sql`${schema.user.tokens} + ${amount}`, updatedAt: new Date() })
      .where(eq(schema.user.id, userId));
  try {
    await db.insert(schema.tokenTransactions).values({
      id: nanoid(),
      userId,
      amount,
      type: "refund",
      description,
      projectId,
      operationKey,
    });
  } catch (error) {
    await db
      .update(schema.user)
      .set({ tokens: sql`${schema.user.tokens} - ${amount}`, updatedAt: new Date() })
      .where(and(eq(schema.user.id, userId), gte(schema.user.tokens, amount)));
    throw error;
  }
}

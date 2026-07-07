import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, desc, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb, schema } from "@app/db";
import type { AppEnv } from "../env";
import { Errors, okJson } from "../lib/response";
import { verifyPlayPurchase } from "../lib/google-play";

export const tokens = new Hono<AppEnv>();

// ---------- GET /tokens/balance ----------
tokens.get("/balance", async (c) => {
	const userId = c.get("userId");
	const db = getDb(c.env.DB);
	const row = await db
		.select({ tokens: schema.user.tokens })
		.from(schema.user)
		.where(eq(schema.user.id, userId))
		.get();
	return okJson(c, { tokens: row?.tokens ?? 0 });
});

// ---------- GET /tokens/history ----------
tokens.get("/history", async (c) => {
	const userId = c.get("userId");
	const db = getDb(c.env.DB);
	const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
	const rows = await db
		.select()
		.from(schema.tokenTransactions)
		.where(eq(schema.tokenTransactions.userId, userId))
		.orderBy(desc(schema.tokenTransactions.createdAt))
		.limit(limit);
	return okJson(c, rows);
});

// ---------- GET /tokens/cost-estimate ----------
tokens.get("/cost-estimate", async (c) => {
	const templateId = c.req.query("templateId");
	const durationSecRaw = c.req.query("durationSec");
	if (!templateId || !durationSecRaw) {
		return Errors.badRequest(c, "templateId and durationSec are required");
	}
	const durationSec = Number(durationSecRaw);
	if (!Number.isFinite(durationSec) || durationSec <= 0) {
		return Errors.badRequest(c, "durationSec must be a positive number");
	}

	const db = getDb(c.env.DB);
	const costRows = await db.select().from(schema.tokenCosts).where(eq(schema.tokenCosts.isActive, true));
	const costOf = (action: string, fallback: number) =>
		costRows.find((r) => r.action === action)?.cost ?? fallback;

	const sceneCount = Math.max(1, Math.ceil(durationSec / 4));

	const scriptCost = costOf("script_generation", 10);
	const voiceCost = costOf("voice_generation", 10);
	const imageCostEach = costOf("image_generation", 5);
	const imagesCost = imageCostEach * sceneCount;
	const render720 = costOf("render_720p", 50);
	const render1080 = costOf("render_1080p", 100);

	const generationTotal = scriptCost + voiceCost + imagesCost;

	return okJson(c, {
		templateId,
		durationSec,
		sceneCount,
		breakdown: {
			script: scriptCost,
			voice: voiceCost,
			images: imagesCost,
			imageCount: sceneCount,
			imageCostEach,
			render_720p: render720,
			render_1080p: render1080,
		},
		generationTotal,
		totalWithRender720p: generationTotal + render720,
		totalWithRender1080p: generationTotal + render1080,
	});
});

// ---------- POST /tokens/purchase/verify ----------
const PurchaseVerifyBody = z.object({
	productId: z.string(),
	purchaseToken: z.string(),
	tokenAmount: z.number().int().positive(),
});

tokens.post("/purchase/verify", zValidator("json", PurchaseVerifyBody), async (c) => {
	const userId = c.get("userId");
	const { productId, purchaseToken, tokenAmount } = c.req.valid("json");
	const db = getDb(c.env.DB);

	// Idempotency guard: don't double-credit if this purchase token was
	// already recorded (description carries the token for lookup).
	const already = await db
		.select({ id: schema.tokenTransactions.id })
		.from(schema.tokenTransactions)
		.where(
			sql`${schema.tokenTransactions.userId} = ${userId} AND ${schema.tokenTransactions.description} LIKE ${"%" + purchaseToken + "%"}`,
		)
		.get();
	if (already) {
		return okJson(c, { credited: false, reason: "already_processed" });
	}

	let verification;
	try {
		verification = await verifyPlayPurchase(c.env, productId, purchaseToken);
	} catch (e) {
		console.error("Play purchase verification failed", e);
		return Errors.badRequest(c, "Could not verify purchase with Google Play");
	}

	if (!verification.valid) {
		return Errors.badRequest(c, "Purchase not in a valid purchased state");
	}

	const now = new Date();
	await db.batch([
		db
			.update(schema.user)
			.set({ tokens: sql`${schema.user.tokens} + ${tokenAmount}`, updatedAt: now })
			.where(eq(schema.user.id, userId)),
		db.insert(schema.tokenTransactions).values({
			id: nanoid(),
			userId,
			amount: tokenAmount,
			type: "purchase",
			description: `Play Billing purchase ${productId} token:${purchaseToken}`,
		}),
	]);

	return okJson(c, { credited: true, tokenAmount });
});

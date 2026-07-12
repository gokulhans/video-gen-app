import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { desc, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb, schema } from "@app/db";
import { DEFAULT_TOKEN_COSTS, TOKEN_ACTIONS } from "@app/shared";
import type { AppEnv } from "../env";
import { Errors, okJson } from "../lib/response";
import { verifyPlayPurchase } from "../lib/google-play";

export const tokens = new Hono<AppEnv>();

tokens.get("/balance", async (c) => {
	const userId = c.get("userId");
	const row = await getDb(c.env.DB).select({ tokens: schema.user.tokens }).from(schema.user)
		.where(eq(schema.user.id, userId)).get();
	return okJson(c, { tokens: row?.tokens ?? 0 });
});

tokens.get("/history", async (c) => {
	const userId = c.get("userId");
	const db = getDb(c.env.DB);
	const limit = Math.min(100, Math.max(1, Number(c.req.query("limit") ?? 50) || 50));
	const offset = Math.max(0, Number(c.req.query("offset") ?? 0) || 0);
	const rows = await db.select().from(schema.tokenTransactions)
		.where(eq(schema.tokenTransactions.userId, userId))
		.orderBy(desc(schema.tokenTransactions.createdAt)).limit(limit).offset(offset);
	return okJson(c, rows);
});

tokens.get("/cost-estimate", async (c) => {
	const action = c.req.query("action");
	const db = getDb(c.env.DB);
	const costRows = await db.select().from(schema.tokenCosts).where(eq(schema.tokenCosts.isActive, true));
	const costOf = (name: keyof typeof DEFAULT_TOKEN_COSTS) =>
		costRows.find((row) => row.action === name)?.cost ?? DEFAULT_TOKEN_COSTS[name];

	if (action) {
		if (!(TOKEN_ACTIONS as readonly string[]).includes(action)) return Errors.badRequest(c, "Unknown token action");
		const total = costOf(action as keyof typeof DEFAULT_TOKEN_COSTS);
		return okJson(c, { total, breakdown: { [action]: total } });
	}

	const templateId = c.req.query("templateId");
	const durationSec = Number(c.req.query("durationSec"));
	if (!templateId || !Number.isFinite(durationSec) || durationSec < 15 || durationSec > 90) {
		return Errors.badRequest(c, "templateId and durationSec (15-90) are required");
	}
	const sceneCount = Math.max(1, Math.ceil(durationSec / 4));
	const breakdown = {
		script: costOf("script_generation"),
		voice: costOf("voice_generation"),
		images: costOf("image_generation") * sceneCount,
		imageCount: sceneCount,
		imageCostEach: costOf("image_generation"),
		render_720p: costOf("render_720p"),
		render_1080p: costOf("render_1080p"),
	};
	const total = breakdown.script + breakdown.voice + breakdown.images;
	return okJson(c, { templateId, durationSec, sceneCount, breakdown, total, generationTotal: total });
});

const PurchaseVerifyBody = z.object({
	productId: z.string().trim().min(1).max(200),
	purchaseToken: z.string().min(20).max(8_000),
});

async function sha256(value: string): Promise<string> {
	const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
	return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

tokens.post("/purchase/verify", zValidator("json", PurchaseVerifyBody), async (c) => {
	const userId = c.get("userId");
	const { productId, purchaseToken } = c.req.valid("json");
	let catalog: Record<string, number>;
	try {
		catalog = JSON.parse(c.env.PLAY_TOKEN_PACKS_JSON) as Record<string, number>;
	} catch {
		return Errors.internal(c, "Purchase catalog is not configured");
	}
	const tokenAmount = catalog[productId];
	if (!Number.isSafeInteger(tokenAmount) || tokenAmount <= 0 || tokenAmount > 100_000) {
		return Errors.badRequest(c, "Unknown purchase product");
	}
	const purchaseTokenHash = await sha256(purchaseToken);
	const db = getDb(c.env.DB);
	const existing = await db.select({ userId: schema.playPurchases.userId }).from(schema.playPurchases)
		.where(eq(schema.playPurchases.purchaseTokenHash, purchaseTokenHash)).get();
	if (existing) {
		if (existing.userId !== userId) return Errors.conflict(c, "Purchase has already been claimed");
		const balance = await db.select({ tokens: schema.user.tokens }).from(schema.user).where(eq(schema.user.id, userId)).get();
		return okJson(c, { tokens: balance?.tokens ?? 0, credited: false });
	}

	let verification;
	try {
		verification = await verifyPlayPurchase(c.env, productId, purchaseToken);
	} catch (error) {
		console.error(JSON.stringify({ event: "play_purchase_verification_failed", error: String(error) }));
		return Errors.badRequest(c, "Could not verify purchase with Google Play");
	}
	if (!verification.valid) return Errors.badRequest(c, "Purchase is not in a valid purchased state");

	const purchaseId = nanoid();
	try {
		await db.batch([
			db.insert(schema.playPurchases).values({
				id: purchaseId, userId, productId, purchaseTokenHash,
				orderId: verification.orderId ?? null, tokenAmount,
			}),
			db.update(schema.user).set({ tokens: sql`${schema.user.tokens} + ${tokenAmount}`, updatedAt: new Date() })
				.where(eq(schema.user.id, userId)),
			db.insert(schema.tokenTransactions).values({
				id: nanoid(), userId, amount: tokenAmount, type: "purchase",
				description: `Play Billing purchase ${productId}`,
				operationKey: `purchase:${purchaseTokenHash}`,
			}),
		]);
	} catch (error) {
		const claimed = await db.select({ userId: schema.playPurchases.userId }).from(schema.playPurchases)
			.where(eq(schema.playPurchases.purchaseTokenHash, purchaseTokenHash)).get();
		if (!claimed) throw error;
		if (claimed.userId !== userId) return Errors.conflict(c, "Purchase has already been claimed");
		const balance = await db.select({ tokens: schema.user.tokens }).from(schema.user).where(eq(schema.user.id, userId)).get();
		return okJson(c, { tokens: balance?.tokens ?? 0, credited: false });
	}
	const balance = await db.select({ tokens: schema.user.tokens }).from(schema.user).where(eq(schema.user.id, userId)).get();
	return okJson(c, { tokens: balance?.tokens ?? 0, credited: true });
});

import { and, asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { getDb, schema } from "@app/db";
import type { AppEnv } from "../env";
import { Errors, okJson } from "../lib/response";
import { presignGet } from "../lib/r2";

export const voices = new Hono<AppEnv>();

voices.get("/", async (c) => {
	const userId = c.get("userId");
	const locale = c.req.query("locale") ?? c.req.query("language");
	const db = getDb(c.env.DB);
	const rows = await db.select().from(schema.voices)
		.where(locale
			? and(eq(schema.voices.isActive, true), eq(schema.voices.locale, locale))
			: eq(schema.voices.isActive, true))
		.orderBy(asc(schema.voices.sortOrder), asc(schema.voices.name));
	const favorites = await db.select({ voiceId: schema.voiceFavorites.voiceId })
		.from(schema.voiceFavorites).where(eq(schema.voiceFavorites.userId, userId));
	const favoriteIds = new Set(favorites.map((row) => row.voiceId));
	return okJson(c, await Promise.all(rows.map(async (voice) => ({
		id: voice.id,
		slug: voice.slug,
		name: voice.name,
		label: voice.name,
		locale: voice.locale,
		style: voice.style,
		tags: Array.isArray(voice.tags) ? voice.tags : [],
		isPremium: voice.isPremium,
		isFavorite: favoriteIds.has(voice.id),
		sampleAssetKey: voice.sampleAssetKey,
		sampleUrl: voice.sampleAssetKey ? await presignGet(c.env, "assets", voice.sampleAssetKey) : null,
		sampleExpiresInSeconds: voice.sampleAssetKey ? 600 : null,
	}))));
});

voices.put("/:voiceId/favorite", async (c) => {
	const userId = c.get("userId");
	const voiceId = c.req.param("voiceId");
	const db = getDb(c.env.DB);
	const voice = await db.select({ id: schema.voices.id }).from(schema.voices)
		.where(and(eq(schema.voices.id, voiceId), eq(schema.voices.isActive, true))).get();
	if (!voice) return Errors.notFound(c, "Voice not found");
	await db.insert(schema.voiceFavorites).values({ userId, voiceId, createdAt: Date.now() })
		.onConflictDoNothing();
	return okJson(c, { voiceId, isFavorite: true });
});

voices.delete("/:voiceId/favorite", async (c) => {
	const userId = c.get("userId");
	const voiceId = c.req.param("voiceId");
	await getDb(c.env.DB).delete(schema.voiceFavorites).where(and(
		eq(schema.voiceFavorites.userId, userId),
		eq(schema.voiceFavorites.voiceId, voiceId),
	));
	return okJson(c, { voiceId, isFavorite: false });
});

import { and, eq, inArray, lte, notExists } from "drizzle-orm";
import { getDb, schema } from "@app/db";
import type { Env } from "../env";

export async function sweepStaleCharacterUploads(env: Env, now = Date.now(), limit = 100, hooks?: { beforeClaim?: (assetId: string) => Promise<void> }) {
	const db = getDb(env.DB);
	const candidates = await db.select().from(schema.userUploadAssets).where(and(
		eq(schema.userUploadAssets.purpose, "character_source"),
		lte(schema.userUploadAssets.cleanupAfter, now),
		inArray(schema.userUploadAssets.status, ["pending", "ready", "cleanup_claimed"]),
		notExists(db.select({ id: schema.userCharacterVersions.id }).from(schema.userCharacterVersions).where(eq(schema.userCharacterVersions.sourceAssetKey, schema.userUploadAssets.objectKey))),
	)).limit(limit);
	let deleted = 0;
	let failed = 0;
	for (const candidate of candidates) {
		try {
			await hooks?.beforeClaim?.(candidate.id);
			const claim = await env.DB.prepare(`UPDATE user_upload_assets SET status='cleanup_claimed', updated_at=?
				WHERE id=? AND purpose='character_source' AND cleanup_after<=?
				AND status IN ('pending','ready','cleanup_claimed')
				AND NOT EXISTS (SELECT 1 FROM user_character_versions WHERE source_asset_key=?)`)
				.bind(now, candidate.id, now, candidate.objectKey).run();
			if ((claim.meta.changes ?? 0) !== 1) continue;
			await env.UPLOADS_BUCKET.delete(candidate.objectKey);
			const result = await env.DB.prepare(`DELETE FROM user_upload_assets
				WHERE id=? AND purpose='character_source' AND cleanup_after<=? AND status='cleanup_claimed'
				AND NOT EXISTS (SELECT 1 FROM user_character_versions WHERE source_asset_key=?)`)
				.bind(candidate.id, now, candidate.objectKey).run();
			if ((result.meta.changes ?? 0) === 1) deleted++;
		} catch (error) {
			failed++;
			console.error(JSON.stringify({ event: "character_upload_cleanup_failed", assetId: candidate.id, error: error instanceof Error ? error.message : String(error) }));
		}
	}
	console.log(JSON.stringify({ event: "character_upload_cleanup_completed", scanned: candidates.length, deleted, failed, at: now }));
	return { scanned: candidates.length, deleted, failed };
}

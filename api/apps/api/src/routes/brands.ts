import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { and, desc, eq, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getDb, schema } from "@app/db";
import type { AppEnv, Env } from "../env";
import { ensureUploadReady, loadUploadRegistration } from "../lib/media";
import { Errors, okJson } from "../lib/response";
import { brandVersionCommitSucceeded,cleanupAfterBrandCommit,legacyOwnedLogoKey,requestFingerprint } from "../lib/brand-notification";

export const brands = new Hono<AppEnv>();

const HexColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/);
const BrandBody = z.object({
	name: z.string().trim().min(1).max(200),
	logoAssetId: z.string().min(8).max(128).optional(),
	// Kept for legacy clients, but only application-owned URLs are accepted.
	logoUrl: z.string().nullable().optional(),
	primaryColor: HexColor.nullable().optional(),
	secondaryColor: HexColor.nullable().optional(),
	font: z.string().trim().max(100).nullable().optional(),
	phone: z.string().trim().max(40).nullable().optional(),
	website: z.string().url().max(500).nullable().optional(),
	watermark: z.boolean().optional(),
	logoPosition: z.enum(["top_left", "top_right", "bottom_left", "bottom_right", "none"]).optional(),
}).strict();

type BrandInput = z.infer<typeof BrandBody>;

function idempotencyKey(c: { req: { header(name: string): string | undefined } }): string | null {
	const value = c.req.header("idempotency-key")?.trim();
	return value && value.length <= 128 ? value : null;
}

function logoUrl(env: Env, key: string | null): string | null {
	if (!key) return null;
	return `${env.APP_BASE_URL.replace(/\/$/, "")}/assets/${key.split("/").map(encodeURIComponent).join("/")}`;
}


async function prepareLogo(env: Env, userId: string, assetId: string): Promise<{ key: string; sourceKey: string }> {
	const record = await loadUploadRegistration(env, assetId);
	if (!record || record.userId !== userId || record.kind !== "image") throw new Error("invalid_logo_asset");
	const ready = await ensureUploadReady(env, record);
	const source = await env.UPLOADS_BUCKET.get(ready.objectKey);
	if (!source?.body) throw new Error("invalid_logo_asset");
	const extension = ready.contentType === "image/png" ? "png" : ready.contentType === "image/webp" ? "webp" : "jpg";
	const key = `users/${userId}/brands/logos/${crypto.randomUUID()}.${extension}`;
	await env.ASSETS_BUCKET.put(key, source.body, { httpMetadata: { contentType: ready.contentType, cacheControl: "public, max-age=31536000, immutable" } });
	return { key, sourceKey: ready.objectKey };
}

async function cleanupConsumedUpload(env: Env, assetId: string, sourceKey: string): Promise<void> {
	await env.UPLOADS_BUCKET.delete(sourceKey);
	await getDb(env.DB).delete(schema.userUploadAssets).where(eq(schema.userUploadAssets.id, assetId));
}
async function cleanupCopiedLogoAfterFailedCommit(env:Env,userId:string,objectKey:string):Promise<void>{try{await env.ASSETS_BUCKET.delete(objectKey);}catch(error){const now=Date.now();await env.DB.prepare(`INSERT OR IGNORE INTO asset_cleanup_outbox (id,user_id,kind,bucket,object_key,status,attempts,next_attempt_at,last_error,created_at) VALUES (?,?,?,?,?,'retry',1,?,?,?)`).bind(nanoid(),userId,"failed_brand_copy","assets",objectKey,now+30_000,error instanceof Error?error.message.slice(0,500):String(error).slice(0,500),now).run();}}


async function publicBrand(env: Env, brandId: string, userId: string) {
	const db = getDb(env.DB);
	const brand = await db.select().from(schema.brands).where(and(eq(schema.brands.id, brandId), eq(schema.brands.userId, userId))).get();
	if (!brand) return null;
	const version = brand.currentVersionId
		? await db.select().from(schema.brandVersions).where(and(eq(schema.brandVersions.id, brand.currentVersionId), eq(schema.brandVersions.userId, userId))).get()
		: null;
	return {
		...brand,
		...(version ?? {}),
		id: brand.id,
		versionId: version?.id ?? null,
		version: version?.version ?? 1,
		logoUrl: logoUrl(env, version?.logoAssetKey ?? legacyOwnedLogoKey(brand.logoUrl, userId)),
		archived: brand.archivedAt != null,
	};
}

brands.get("/", async (c) => {
	const db = getDb(c.env.DB);
	const includeArchived = c.req.query("includeArchived") === "true";
	const rows = await db.select({ id: schema.brands.id }).from(schema.brands)
		.where(includeArchived ? eq(schema.brands.userId, c.get("userId")) : and(eq(schema.brands.userId, c.get("userId")), isNull(schema.brands.archivedAt)))
		.orderBy(desc(schema.brands.updatedAt));
	return okJson(c, (await Promise.all(rows.map((row) => publicBrand(c.env, row.id, c.get("userId"))))).filter(Boolean));
});

brands.get("/:id", async (c) => {
	const row = await publicBrand(c.env, c.req.param("id"), c.get("userId"));
	return row ? okJson(c, row) : Errors.notFound(c, "Brand not found");
});

async function replay(env: Env, userId: string, key: string, action: string, targetId: string | null, fingerprint: string) {
	const mutation = await getDb(env.DB).select().from(schema.brandMutations)
		.where(and(eq(schema.brandMutations.userId, userId), eq(schema.brandMutations.idempotencyKey, key))).get();
	if (!mutation) return null;
	if (mutation.action !== action || mutation.targetId !== targetId || mutation.requestFingerprint !== fingerprint) return { mismatch: true } as const;
	if (!mutation.responseSnapshot) throw new Error("brand_mutation_snapshot_missing");
	return { mismatch: false, value: JSON.parse(mutation.responseSnapshot) as unknown } as const;
}

brands.post("/", zValidator("json", BrandBody), async (c) => {
	const userId = c.get("userId");
	const key = idempotencyKey(c);
	if (!key) return Errors.validation(c,"Idempotency-Key header is required");
	const body = c.req.valid("json");
	const fingerprint=await requestFingerprint(body);
	const prior = await replay(c.env, userId, key,"create",null,fingerprint);
	if (prior) return prior.mismatch?Errors.conflict(c,"Idempotency-Key was already used for a different mutation"):okJson(c,prior.value);
	if (body.logoUrl && !legacyOwnedLogoKey(body.logoUrl, userId)) return Errors.validation(c, "logoUrl must reference an owned application asset");
	let prepared: { key: string; sourceKey: string } | null = null;
	try {
		if (body.logoAssetId) prepared = await prepareLogo(c.env, userId, body.logoAssetId);
	} catch { return Errors.validation(c, "Logo upload must be finalized, owned, and an image"); }
	const brandId = nanoid();
	const versionId = nanoid();
	const now = Date.now();
	const ownedLegacyKey = legacyOwnedLogoKey(body.logoUrl, userId);
	const logoKey = prepared?.key ?? ownedLegacyKey;
	const snapshot={id:brandId,userId,name:body.name,logoUrl:logoUrl(c.env,logoKey),primaryColor:body.primaryColor??null,secondaryColor:body.secondaryColor??null,font:body.font??null,phone:body.phone??null,website:body.website??null,watermark:body.watermark??true,logoPosition:body.logoPosition??"top_right",currentVersionId:versionId,archivedAt:null,createdAt:now,updatedAt:now,brandId,version:1,versionId,logoAssetKey:logoKey,archived:false};
	const cleanupId=prepared?nanoid():null;
	try {
		const results=await c.env.DB.batch([
			c.env.DB.prepare(`INSERT INTO brands (id,user_id,name,logo_url,primary_color,secondary_color,font,phone,website,watermark,logo_position,current_version_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
				.bind(brandId,userId,body.name,logoUrl(c.env,logoKey),body.primaryColor ?? null,body.secondaryColor ?? null,body.font ?? null,body.phone ?? null,body.website ?? null,body.watermark ?? true,body.logoPosition ?? "top_right",versionId,now,now),
			c.env.DB.prepare(`INSERT INTO brand_versions (id,brand_id,user_id,version,name,logo_asset_key,primary_color,secondary_color,font,phone,website,watermark,logo_position,created_at) VALUES (?,?,?,1,?,?,?,?,?,?,?,?,?,?)`)
				.bind(versionId,brandId,userId,body.name,logoKey,body.primaryColor ?? null,body.secondaryColor ?? null,body.font ?? null,body.phone ?? null,body.website ?? null,body.watermark ?? true,body.logoPosition ?? "top_right",now),
			c.env.DB.prepare(`INSERT INTO brand_mutations (id,user_id,idempotency_key,brand_id,brand_version_id,action,target_id,request_fingerprint,response_snapshot,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(nanoid(),userId,key,brandId,versionId,"create",null,fingerprint,JSON.stringify(snapshot),now),
			...(prepared&&body.logoAssetId?[c.env.DB.prepare(`INSERT INTO asset_cleanup_outbox (id,user_id,kind,bucket,object_key,upload_asset_id,status,attempts,next_attempt_at,created_at) VALUES (?,?,?,?,?,?,'pending',0,?,?)`).bind(cleanupId,userId,"consumed_brand_upload","uploads",prepared.sourceKey,body.logoAssetId,now,now)]:[]),
		]);
		if ((results[0].meta.changes ?? 0)!==1 || (results[1].meta.changes ?? 0)!==1 || (results[2]?.meta.changes ?? 0)!==1) {
			throw new Error("brand_create_not_committed");
		}
	} catch (error) {
		if (prepared) await cleanupCopiedLogoAfterFailedCommit(c.env,userId,prepared.key);
		const raced = await replay(c.env, userId, key,"create",null,fingerprint);
		if (raced&&!raced.mismatch) return okJson(c, raced.value);
		throw error;
	}
	if (prepared && body.logoAssetId) await cleanupAfterBrandCommit(
		async()=>{await cleanupConsumedUpload(c.env,body.logoAssetId!,prepared!.sourceKey);await c.env.DB.prepare("UPDATE asset_cleanup_outbox SET status='completed',completed_at=? WHERE id=?").bind(Date.now(),cleanupId).run();},
		(error)=>console.error(JSON.stringify({event:"brand_logo_upload_cleanup_failed",brandId,error:error instanceof Error?error.message:String(error)})),
	);
	return okJson(c, snapshot, 201);
});

brands.patch("/:id", zValidator("json", BrandBody.partial()), async (c) => {
	const userId = c.get("userId");
	const brandId = c.req.param("id");
	const key = idempotencyKey(c);
	if (!key) return Errors.validation(c,"Idempotency-Key header is required");
	const body = c.req.valid("json");
	const fingerprint=await requestFingerprint(body);
	const prior = await replay(c.env, userId, key,"update",brandId,fingerprint);
	if (prior) return prior.mismatch?Errors.conflict(c,"Idempotency-Key was already used for a different mutation"):okJson(c,prior.value);
	const current = await publicBrand(c.env, brandId, userId);
	if (!current) return Errors.notFound(c, "Brand not found");
	if (body.logoUrl && !legacyOwnedLogoKey(body.logoUrl, userId)) return Errors.validation(c, "logoUrl must reference an owned application asset");
	let prepared: { key: string; sourceKey: string } | null = null;
	try { if (body.logoAssetId) prepared = await prepareLogo(c.env, userId, body.logoAssetId); }
	catch { return Errors.validation(c, "Logo upload must be finalized, owned, and an image"); }
	const next = { ...current, ...body };
	const logoKey = prepared?.key ?? legacyOwnedLogoKey(body.logoUrl, userId) ?? current.logoAssetKey ?? null;
	const versionId = nanoid();
	const version = Number(current.version) + 1;
	const now = Date.now();
	const snapshot={...current,...next,id:brandId,brandId,versionId,version,logoAssetKey:logoKey,logoUrl:logoUrl(c.env,logoKey),updatedAt:now};
	const cleanupId=prepared?nanoid():null;
	try {
		const results=await c.env.DB.batch([
			c.env.DB.prepare(`INSERT INTO brand_versions (id,brand_id,user_id,version,name,logo_asset_key,primary_color,secondary_color,font,phone,website,watermark,logo_position,created_at)
				SELECT ?,id,user_id,?,?,?,?,?,?,?,?,?,?,? FROM brands WHERE id=? AND user_id=? AND current_version_id=?`)
				.bind(versionId,version,next.name,logoKey,next.primaryColor ?? null,next.secondaryColor ?? null,next.font ?? null,next.phone ?? null,next.website ?? null,next.watermark,next.logoPosition,now,brandId,userId,current.versionId),
			c.env.DB.prepare(`UPDATE brands SET name=?,logo_url=?,primary_color=?,secondary_color=?,font=?,phone=?,website=?,watermark=?,logo_position=?,current_version_id=?,updated_at=? WHERE id=? AND user_id=? AND current_version_id=?`)
				.bind(next.name,logoUrl(c.env,logoKey),next.primaryColor ?? null,next.secondaryColor ?? null,next.font ?? null,next.phone ?? null,next.website ?? null,next.watermark,next.logoPosition,versionId,now,brandId,userId,current.versionId),
			c.env.DB.prepare(`INSERT INTO brand_mutations (id,user_id,idempotency_key,brand_id,brand_version_id,action,target_id,request_fingerprint,response_snapshot,created_at)
				SELECT ?,?,?,brand_id,id,?,?,?,?,? FROM brand_versions WHERE id=? AND user_id=?`).bind(nanoid(),userId,key,"update",brandId,fingerprint,JSON.stringify(snapshot),now,versionId,userId),
			...(prepared&&body.logoAssetId?[c.env.DB.prepare(`INSERT INTO asset_cleanup_outbox (id,user_id,kind,bucket,object_key,upload_asset_id,status,attempts,next_attempt_at,created_at) VALUES (?,?,?,?,?,?,'pending',0,?,?)`).bind(cleanupId,userId,"consumed_brand_upload","uploads",prepared.sourceKey,body.logoAssetId,now,now)]:[]),
		]);
		const versionChanged=results[0].meta.changes ?? 0;
		const parentChanged=results[1].meta.changes ?? 0;
		const mutationChanged=results[2]?.meta.changes ?? 0;
		if(!brandVersionCommitSucceeded(versionChanged,parentChanged,mutationChanged)){
			if(prepared)await cleanupCopiedLogoAfterFailedCommit(c.env,userId,prepared.key);
			return Errors.conflict(c,"Brand changed in another session. Refresh and retry.");
		}
	} catch (error) {
		if (prepared) await cleanupCopiedLogoAfterFailedCommit(c.env,userId,prepared.key);
		const raced = await replay(c.env, userId, key,"update",brandId,fingerprint);
		if (raced&&!raced.mismatch) return okJson(c, raced.value);
		throw error;
	}
	if (prepared && body.logoAssetId) await cleanupAfterBrandCommit(
		async()=>{await cleanupConsumedUpload(c.env,body.logoAssetId!,prepared!.sourceKey);await c.env.DB.prepare("UPDATE asset_cleanup_outbox SET status='completed',completed_at=? WHERE id=?").bind(Date.now(),cleanupId).run();},
		(error)=>console.error(JSON.stringify({event:"brand_logo_upload_cleanup_failed",brandId,error:error instanceof Error?error.message:String(error)})),
	);
	return okJson(c, snapshot);
});

brands.post("/:id/archive", async (c) => {
	const result = await c.env.DB.prepare("UPDATE brands SET archived_at=COALESCE(archived_at,?),updated_at=? WHERE id=? AND user_id=?")
		.bind(Date.now(),Date.now(),c.req.param("id"),c.get("userId")).run();
	return (result.meta.changes ?? 0) > 0 ? okJson(c, await publicBrand(c.env,c.req.param("id"),c.get("userId"))) : Errors.notFound(c,"Brand not found");
});

// Legacy DELETE is now a reversible archive, preserving project/version history.
brands.delete("/:id", async (c) => {
	const result = await c.env.DB.prepare("UPDATE brands SET archived_at=COALESCE(archived_at,?),updated_at=? WHERE id=? AND user_id=?")
		.bind(Date.now(),Date.now(),c.req.param("id"),c.get("userId")).run();
	return (result.meta.changes ?? 0) > 0 ? okJson(c,{ id:c.req.param("id"), archived:true }) : Errors.notFound(c,"Brand not found");
});

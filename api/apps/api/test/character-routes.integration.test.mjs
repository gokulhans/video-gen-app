import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { Miniflare } from "miniflare";
import { Hono } from "hono";
import { characters } from "../src/routes/characters.ts";
import { voices } from "../src/routes/voices.ts";
import { assets } from "../src/routes/assets.ts";
import adminCharacters from "../../admin/src/routes/characters.ts";
import { sweepStaleCharacterUploads } from "../src/services/character-upload-cleanup.ts";

let mf;
let db;
let uploads;
let env;
let app;
let adminApp;

before(async () => {
	mf = new Miniflare({
		modules: true,
		script: "export default { fetch(){ return new Response('ok') } }",
		compatibilityDate: "2026-07-08",
		d1Databases: { DB: "character-test" },
		r2Buckets: ["UPLOADS_BUCKET", "ASSETS_BUCKET"],
	});
	db = await mf.getD1Database("DB");
	uploads = await mf.getR2Bucket("UPLOADS_BUCKET");
	await db.exec(`
		PRAGMA foreign_keys=ON;
		CREATE TABLE user (id TEXT PRIMARY KEY, email TEXT);
		CREATE TABLE voices (id TEXT PRIMARY KEY, slug TEXT, name TEXT, locale TEXT, style TEXT, sample_asset_key TEXT, tags TEXT, is_premium INTEGER, is_active INTEGER, sort_order INTEGER, created_at INTEGER, updated_at INTEGER);
		CREATE TABLE voice_favorites (user_id TEXT, voice_id TEXT, created_at INTEGER, PRIMARY KEY(user_id, voice_id));
		CREATE TABLE stock_characters (id TEXT PRIMARY KEY, slug TEXT, name TEXT, preview_asset_key TEXT, tags TEXT, consent_status TEXT, license_expires_at INTEGER, is_active INTEGER, created_at INTEGER, updated_at INTEGER);
		CREATE TABLE user_upload_assets (id TEXT PRIMARY KEY, user_id TEXT, object_key TEXT, kind TEXT, content_type TEXT, declared_size INTEGER, actual_size INTEGER, status TEXT, created_at INTEGER, updated_at INTEGER, finalized_at INTEGER, purpose TEXT, cleanup_after INTEGER);
		CREATE TABLE user_characters (id TEXT PRIMARY KEY, user_id TEXT, name TEXT, status TEXT, current_version_id TEXT, created_at INTEGER, updated_at INTEGER, archived_at INTEGER);
		CREATE TABLE user_character_versions (id TEXT PRIMARY KEY, user_character_id TEXT REFERENCES user_characters(id) ON DELETE RESTRICT, user_id TEXT, version INTEGER, status TEXT, source_asset_key TEXT UNIQUE, preview_asset_key TEXT, consent_record TEXT, provider_refs TEXT, moderation_result TEXT, created_at INTEGER, ready_at INTEGER);
		CREATE TABLE generation_jobs (id TEXT PRIMARY KEY, user_id TEXT, user_character_version_id TEXT);
		CREATE TABLE character_mutations (id TEXT PRIMARY KEY, user_id TEXT, idempotency_key TEXT, request_fingerprint TEXT, response_snapshot TEXT NOT NULL, asset_id TEXT UNIQUE REFERENCES user_upload_assets(id) ON DELETE RESTRICT, character_id TEXT REFERENCES user_characters(id) ON DELETE CASCADE, created_at INTEGER, UNIQUE(user_id,idempotency_key));
		CREATE TABLE admin_audit_events (id TEXT PRIMARY KEY, actor_user_id TEXT, request_id TEXT, action TEXT, target_type TEXT, target_id TEXT, reason TEXT, before_summary TEXT, after_summary TEXT, created_at INTEGER DEFAULT 0);
	`);
	await db.prepare("INSERT INTO user VALUES (?,?), (?,?)").bind("tenant-a", "a@test", "tenant-b", "b@test").run();
	await db.prepare("INSERT INTO voices VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").bind("voice-1", "warm", "Warm guide", "en-IN", "warm", null, "[]", 0, 1, 0, 1, 1).run();
	await db.prepare("INSERT INTO user_upload_assets VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").bind("asset-a", "tenant-a", "user-uploads/tenant-a/source.jpg", "image", "image/jpeg", 3, 3, "ready", 1, 1, 1, "character_source", Date.now() + 100000).run();
	await db.prepare("INSERT INTO user_upload_assets VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").bind("asset-b-abandoned", "tenant-b", "user-uploads/tenant-b/abandoned.jpg", "image", "image/jpeg", 3, 3, "ready", 1, 1, 1, "character_source", Date.now() + 100000).run();
	await uploads.put("user-uploads/tenant-a/source.jpg", new Uint8Array([1, 2, 3]), { httpMetadata: { contentType: "image/jpeg" } });
	await uploads.put("user-uploads/tenant-b/abandoned.jpg", new Uint8Array([4, 5, 6]), { httpMetadata: { contentType: "image/jpeg" } });
	await db.prepare("INSERT INTO user_upload_assets VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").bind("asset-moderate", "tenant-a", "user-uploads/tenant-a/moderate.jpg", "image", "image/jpeg", 3, 3, "ready", 1, 1, 1, "character_source", Date.now() + 100000).run();
	await db.prepare("INSERT INTO user_upload_assets VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").bind("asset-moderate-stale", "tenant-a", "user-uploads/tenant-a/moderate-stale.jpg", "image", "image/jpeg", 3, 3, "ready", 1, 1, 1, "character_source", Date.now() + 100000).run();
	await uploads.put("user-uploads/tenant-a/moderate.jpg", new Uint8Array([7, 8, 9]), { httpMetadata: { contentType: "image/jpeg" } });
	await db.prepare("INSERT INTO user_characters VALUES (?,?,?,?,?,?,?,?), (?,?,?,?,?,?,?,?)").bind("moderate-ok", "tenant-a", "Moderate me", "pending_review", "moderate-v1", 1, 1, null, "moderate-stale", "tenant-a", "Stale", "pending_review", "other-version", 1, 1, null).run();
	const consent = JSON.stringify({ confirmed: true, sourceAssetId: "asset-moderate" });
	const staleConsent = JSON.stringify({ confirmed: true, sourceAssetId: "asset-moderate-stale" });
	await db.prepare("INSERT INTO user_character_versions VALUES (?,?,?,?,?,?,?,?,?,?,?,?), (?,?,?,?,?,?,?,?,?,?,?,?)").bind("moderate-v1", "moderate-ok", "tenant-a", 1, "pending_review", "user-uploads/tenant-a/moderate.jpg", null, consent, null, null, 1, null, "stale-v1", "moderate-stale", "tenant-a", 1, "pending_review", "user-uploads/tenant-a/moderate-stale.jpg", null, staleConsent, null, null, 1, null).run();
	env = {
		DB: db,
		UPLOADS_BUCKET: uploads,
		ASSETS_BUCKET: await mf.getR2Bucket("ASSETS_BUCKET"),
		R2_ACCOUNT_ID: "test-account",
		R2_ACCESS_KEY_ID: "test-access-key",
		R2_SECRET_ACCESS_KEY: "test-secret-key",
		APP_BASE_URL: "https://app.test",
	};
	app = new Hono();
	app.use("*", async (c, next) => { c.set("userId", c.req.header("x-test-user") ?? "tenant-a"); await next(); });
	app.route("/characters", characters);
	app.route("/voices", voices);
	app.route("/assets", assets);
	adminApp = new Hono();
	adminApp.use("*", async (c, next) => {
		c.set("adminUser", { id: "admin-1", email: "admin@test", name: "Admin", isSuperAdmin: false, permissions: ["characters.moderate"] });
		c.set("requestId", "request-1");
		await next();
	});
	adminApp.route("/characters", adminCharacters);
});

after(async () => mf?.dispose());

const request = (path, user, init = {}) => app.request(path, { ...init, headers: { "content-type": "application/json", "x-test-user": user, ...(init.headers ?? {}) } }, env);

test("two tenants cannot reuse or see each other's character source", async () => {
	const denied = await request("/characters/mine", "tenant-b", { method: "POST", body: JSON.stringify({ name: "Stolen", assetId: "asset-a", consent: { confirmed: true, statement: "I have explicit permission" } }) });
	assert.equal(denied.status, 422);
	const createBody = JSON.stringify({ name: "My host", assetId: "asset-a", consent: { confirmed: true, statement: "I own this source image" } });
	const created = await request("/characters/mine", "tenant-a", { method: "POST", headers: { "Idempotency-Key": "character-create-1" }, body: createBody });
	assert.equal(created.status, 201);
	const createdData = (await created.json()).data;
	const replayed = await request("/characters/mine", "tenant-a", { method: "POST", headers: { "Idempotency-Key": "character-create-1" }, body: createBody });
	assert.equal(replayed.status, 201);
	assert.deepEqual((await replayed.json()).data, createdData);
	assert.equal(replayed.headers.get("x-idempotent-replay"), "true");
	const mismatch = await request("/characters/mine", "tenant-a", { method: "POST", headers: { "Idempotency-Key": "character-create-1" }, body: JSON.stringify({ name: "Different", assetId: "asset-a", consent: { confirmed: true, statement: "I own this source image" } }) });
	assert.equal(mismatch.status, 409);
	const reused = await request("/characters/mine", "tenant-a", { method: "POST", headers: { "Idempotency-Key": "character-create-2" }, body: createBody });
	assert.equal(reused.status, 409);
	const mineB = await request("/characters/mine", "tenant-b");
	assert.deepEqual((await mineB.json()).data, []);
	const mineA = await request("/characters/mine", "tenant-a");
	const row = (await mineA.json()).data[0];
	assert.equal(row.status, "pending_review");
	assert.match(row.previewUrl, /^https:\/\/test-account\.r2\.cloudflarestorage\.com\/uploads\//);
	const crossDelete = await request(`/characters/mine/${row.id}`, "tenant-b", { method: "DELETE" });
	assert.equal(crossDelete.status, 404);
	const crossUploadDelete = await request("/assets/asset-a", "tenant-b", { method: "DELETE" });
	assert.equal(crossUploadDelete.status, 403);
	const approved = await adminApp.request(`/characters/review/${createdData.currentVersionId}/decision`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision: "approve", reason: "Verified source and consent" }) }, { ...env, KV: { delete: async () => {} } });
	assert.equal(approved.status, 200);
	const postApproveReplay = await request("/characters/mine", "tenant-a", { method: "POST", headers: { "Idempotency-Key": "character-create-1" }, body: createBody });
	assert.equal(postApproveReplay.status, 201);
	assert.deepEqual((await postApproveReplay.json()).data, createdData);
	assert.equal((await db.prepare("SELECT status FROM user_characters WHERE id=?").bind(row.id).first()).status, "ready");
	assert.equal((await request(`/characters/mine/${row.id}/archive`, "tenant-a", { method: "PATCH" })).status, 200);
	const postArchiveReplay = await request("/characters/mine", "tenant-a", { method: "POST", headers: { "Idempotency-Key": "character-create-1" }, body: createBody });
	assert.equal(postArchiveReplay.status, 201);
	assert.deepEqual((await postArchiveReplay.json()).data, createdData);
	assert.equal((await db.prepare("SELECT status FROM user_characters WHERE id=?").bind(row.id).first()).status, "archived");
	const ownDelete = await request(`/characters/mine/${row.id}`, "tenant-a", { method: "DELETE" });
	assert.equal(ownDelete.status, 200);
	assert.equal(await db.prepare("SELECT id FROM character_mutations WHERE character_id=?").bind(row.id).first(), null);
	assert.equal(await db.prepare("SELECT id FROM user_upload_assets WHERE id='asset-a'").first(), null);
	assert.equal(await uploads.head("user-uploads/tenant-a/source.jpg"), null);
});

test("consent and favorites remain tenant specific", async () => {
	const noConsent = await request("/characters/mine", "tenant-a", { method: "POST", body: JSON.stringify({ name: "No consent", assetId: "asset-a", consent: { confirmed: false, statement: "I do not consent" } }) });
	assert.equal(noConsent.status, 400);
	assert.equal((await request("/voices/voice-1/favorite", "tenant-a", { method: "PUT" })).status, 200);
	const listA = (await (await request("/voices", "tenant-a")).json()).data;
	const listB = (await (await request("/voices", "tenant-b")).json()).data;
	assert.equal(listA[0].isFavorite, true);
	assert.equal(listB[0].isFavorite, false);
	const cleaned = await request("/assets/asset-b-abandoned", "tenant-b", { method: "DELETE" });
	assert.equal(cleaned.status, 200);
	assert.equal(await uploads.head("user-uploads/tenant-b/abandoned.jpg"), null);
	assert.equal(await db.prepare("SELECT id FROM user_upload_assets WHERE id=?").bind("asset-b-abandoned").first(), null);
});

test("moderation approval is atomic and stale current versions cannot transition", async () => {
	const approved = await adminApp.request("/characters/review/moderate-v1/decision", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision: "approve", reason: "Consent and source verified" }) }, { ...env, KV: { delete: async () => {} } });
	assert.equal(approved.status, 200);
	const parent = await db.prepare("SELECT status FROM user_characters WHERE id='moderate-ok'").first();
	const version = await db.prepare("SELECT status, ready_at FROM user_character_versions WHERE id='moderate-v1'").first();
	assert.equal(parent.status, "ready");
	assert.equal(version.status, "ready");
	assert.ok(version.ready_at);

	const stale = await adminApp.request("/characters/review/stale-v1/decision", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision: "reject", reason: "Current version changed" }) }, { ...env, KV: { delete: async () => {} } });
	assert.equal(stale.status, 409);
	assert.equal((await db.prepare("SELECT status FROM user_characters WHERE id='moderate-stale'").first()).status, "pending_review");
	assert.equal((await db.prepare("SELECT status FROM user_character_versions WHERE id='stale-v1'").first()).status, "pending_review");

	await db.prepare("INSERT INTO user_characters VALUES (?,?,?,?,?,?,?,?)").bind("moderate-audit-fail", "tenant-a", "Audit fail", "pending_review", "audit-fail-v1", 1, 1, null).run();
	await db.prepare("INSERT INTO user_upload_assets VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").bind("asset-audit-fail", "tenant-a", "user-uploads/tenant-a/audit-fail.jpg", "image", "image/jpeg", 3, 3, "ready", 1, 1, 1, "character_source", Date.now() + 100000).run();
	await db.prepare("INSERT INTO user_character_versions VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").bind("audit-fail-v1", "moderate-audit-fail", "tenant-a", 1, "pending_review", "user-uploads/tenant-a/audit-fail.jpg", null, JSON.stringify({ confirmed: true, sourceAssetId: "asset-audit-fail" }), null, null, 1, null).run();
	await db.exec("CREATE TRIGGER fail_character_audit BEFORE INSERT ON admin_audit_events WHEN NEW.target_id='audit-fail-v1' BEGIN SELECT RAISE(ABORT, 'injected audit failure'); END;");
	const auditFailure = await adminApp.request("/characters/review/audit-fail-v1/decision", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision: "reject", reason: "Injected audit failure" }) }, { ...env, KV: { delete: async () => {} } });
	assert.equal(auditFailure.status, 500);
	assert.equal((await db.prepare("SELECT status FROM user_characters WHERE id='moderate-audit-fail'").first()).status, "pending_review");
	assert.equal((await db.prepare("SELECT status FROM user_character_versions WHERE id='audit-fail-v1'").first()).status, "pending_review");
	assert.equal(await db.prepare("SELECT id FROM admin_audit_events WHERE target_id='audit-fail-v1'").first(), null);
	await db.exec("DROP TRIGGER fail_character_audit;");
});

test("scheduled cleanup is bounded idempotent and excludes attached sources", async () => {
	await db.prepare("INSERT INTO user_upload_assets VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").bind("asset-stale", "tenant-b", "user-uploads/tenant-b/stale.jpg", "image", "image/jpeg", 3, 3, "ready", 1, 1, 1, "character_source", 1).run();
	await uploads.put("user-uploads/tenant-b/stale.jpg", new Uint8Array([1, 1, 1]));
	await db.prepare("UPDATE user_upload_assets SET cleanup_after=1 WHERE id='asset-moderate'").run();
	const first = await sweepStaleCharacterUploads(env, 2, 10);
	assert.equal(first.deleted, 1);
	assert.equal(await uploads.head("user-uploads/tenant-b/stale.jpg"), null);
	assert.ok(await uploads.head("user-uploads/tenant-a/moderate.jpg"));
	const second = await sweepStaleCharacterUploads(env, 2, 10);
	assert.equal(second.deleted, 0);

	await db.prepare("INSERT INTO user_upload_assets VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").bind("asset-race", "tenant-b", "user-uploads/tenant-b/race.jpg", "image", "image/jpeg", 3, 3, "ready", 1, 1, 1, "character_source", 1).run();
	await uploads.put("user-uploads/tenant-b/race.jpg", new Uint8Array([2, 2, 2]));
	const raced = await sweepStaleCharacterUploads(env, 2, 10, { beforeClaim: async (assetId) => {
		if (assetId !== "asset-race") return;
		await db.prepare("INSERT INTO user_characters VALUES (?,?,?,?,?,?,?,?)").bind("race-char", "tenant-b", "Race", "pending_review", "race-v1", 1, 1, null).run();
		await db.prepare("INSERT INTO user_character_versions VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").bind("race-v1", "race-char", "tenant-b", 1, "pending_review", "user-uploads/tenant-b/race.jpg", null, JSON.stringify({ confirmed: true, sourceAssetId: "asset-race" }), null, null, 1, null).run();
	} });
	assert.equal(raced.deleted, 0);
	assert.ok(await uploads.head("user-uploads/tenant-b/race.jpg"));
	assert.equal((await db.prepare("SELECT status FROM user_upload_assets WHERE id='asset-race'").first()).status, "ready");

	await db.prepare("INSERT INTO user_upload_assets VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").bind("asset-retry", "tenant-b", "user-uploads/tenant-b/retry.jpg", "image", "image/jpeg", 3, 3, "ready", 1, 1, 1, "character_source", 1).run();
	await uploads.put("user-uploads/tenant-b/retry.jpg", new Uint8Array([3, 3, 3]));
	const failingEnv = { ...env, UPLOADS_BUCKET: { delete: async () => { throw new Error("injected r2 failure"); } } };
	const failed = await sweepStaleCharacterUploads(failingEnv, 2, 10);
	assert.equal(failed.failed, 1);
	assert.equal((await db.prepare("SELECT status FROM user_upload_assets WHERE id='asset-retry'").first()).status, "cleanup_claimed");
	const retried = await sweepStaleCharacterUploads(env, 2, 10);
	assert.equal(retried.deleted, 1);
	assert.equal(await db.prepare("SELECT id FROM user_upload_assets WHERE id='asset-retry'").first(), null);
});

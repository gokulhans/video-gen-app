import assert from "node:assert/strict";
import test from "node:test";

import { Hono } from "hono";
import { Miniflare } from "miniflare";

import { verifyGenerationMasterIngestToken } from "../src/lib/media.ts";
import { assets } from "../src/routes/assets.ts";

test("a completed generation exposes a private signed playback link only to its owner", async (t) => {
  const mf = new Miniflare({
    modules: true,
    script: "export default { fetch(){ return new Response('ok') } }",
    compatibilityDate: "2026-07-08",
    d1Databases: { DB: "generation-asset-test" },
  });
  t.after(async () => mf.dispose());
  const db = await mf.getD1Database("DB");
  await db.prepare(
    "CREATE TABLE generation_jobs (id TEXT PRIMARY KEY, user_id TEXT NOT NULL)",
  ).run();
  await db.prepare(`
    CREATE TABLE generation_assets (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES generation_jobs(id),
      attempt_id TEXT,
      kind TEXT NOT NULL,
      storage TEXT NOT NULL,
      object_key TEXT NOT NULL,
      content_type TEXT,
      byte_size INTEGER,
      checksum TEXT,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      ready_at INTEGER
    )
  `).run();

  const userId = "generation-owner";
  const jobId = "job-completed";
  const assetId = "asset-master";
  const objectKey = `users/${userId}/generation-jobs/${jobId}/master.mp4`;
  const now = Date.now();
  await db.prepare("INSERT INTO generation_jobs VALUES (?,?)").bind(jobId, userId).run();
  await db.prepare("INSERT INTO generation_assets VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
    .bind(assetId, jobId, null, "video_master", "r2", objectKey, "video/mp4", 4_096, "etag-ready", "ready", now, now).run();

  const secret = "test-media-signing-secret-at-least-thirty-two-characters";
  const env = {
    DB: db,
    APP_BASE_URL: "https://api.example.test",
    MEDIA_INGEST_SIGNING_SECRET: secret,
    PLAYBACK_PROVIDER: "r2",
  };
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("userId", c.req.header("x-test-user") ?? userId);
    await next();
  });
  app.route("/assets", assets);

  const owned = await app.request(`/assets/generation/${assetId}`, {
    headers: { "x-test-user": userId },
  }, env);
  assert.equal(owned.status, 200);
  const delivery = (await owned.json()).data;
  assert.equal(delivery.assetId, assetId);
  assert.equal(delivery.jobId, jobId);
  assert.equal(delivery.status, "ready");
  assert.equal(delivery.contentType, "video/mp4");
  assert.equal(delivery.playbackUrl, delivery.downloadUrl);
  assert.match(delivery.playbackUrl, /^https:\/\/api\.example\.test\/media\/generation\//);
  assert.equal(delivery.playbackUrl.includes(objectKey), false);
  const token = delivery.playbackUrl.split("/").at(-1);
  assert.equal(await verifyGenerationMasterIngestToken(secret, token), objectKey);

  const denied = await app.request(`/assets/generation/${assetId}`, {
    headers: { "x-test-user": "different-user" },
  }, env);
  assert.equal(denied.status, 404);
  assert.equal((await denied.json()).error.code, "not_found");
});

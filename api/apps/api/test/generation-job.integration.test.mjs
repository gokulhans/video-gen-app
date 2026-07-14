import assert from "node:assert/strict";
import test from "node:test";

import { Miniflare } from "miniflare";

import {
  createGenerationJob,
  getGenerationJob,
  listGenerationJobs,
} from "../src/services/generation.ts";

test("generation job atomically reserves credits with foreign keys enabled", async (t) => {
  const mf = new Miniflare({
    modules: true,
    script: "export default { fetch(){ return new Response('ok') } }",
    compatibilityDate: "2026-07-08",
    d1Databases: { DB: "generation-job-test" },
  });
  t.after(async () => mf.dispose());
  const db = await mf.getD1Database("DB");
  await db.exec(`
    CREATE TABLE user (id TEXT PRIMARY KEY, tokens INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE projects (id TEXT PRIMARY KEY);
    CREATE TABLE templates (id TEXT PRIMARY KEY);
    CREATE TABLE template_versions (id TEXT PRIMARY KEY);
    CREATE TABLE pricing_versions (id TEXT PRIMARY KEY);
    CREATE TABLE voices (id TEXT PRIMARY KEY);
    CREATE TABLE stock_characters (id TEXT PRIMARY KEY);
    CREATE TABLE user_character_versions (id TEXT PRIMARY KEY);
    CREATE TABLE generation_quotes (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES user(id), payload TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE generation_jobs (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES user(id), project_id TEXT REFERENCES projects(id), template_id TEXT NOT NULL REFERENCES templates(id), template_version_id TEXT NOT NULL REFERENCES template_versions(id), pricing_version_id TEXT NOT NULL REFERENCES pricing_versions(id), voice_id TEXT REFERENCES voices(id), stock_character_id TEXT REFERENCES stock_characters(id), user_character_version_id TEXT REFERENCES user_character_versions(id), idempotency_key TEXT NOT NULL, request_id TEXT NOT NULL, workflow_instance_id TEXT UNIQUE, status TEXT NOT NULL, progress INTEGER NOT NULL, normalized_inputs TEXT NOT NULL, configuration_snapshot TEXT NOT NULL, quoted_credits INTEGER NOT NULL, estimated_cost_micros INTEGER NOT NULL, actual_cost_micros INTEGER NOT NULL, error_code TEXT, error_message TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, completed_at INTEGER, UNIQUE(user_id, idempotency_key));
    CREATE TABLE token_transactions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES user(id), amount INTEGER NOT NULL, type TEXT NOT NULL, description TEXT, operation_key TEXT UNIQUE, created_at INTEGER NOT NULL);
    CREATE TABLE credit_reservations (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES user(id), job_id TEXT NOT NULL UNIQUE REFERENCES generation_jobs(id), operation_key TEXT NOT NULL, amount INTEGER NOT NULL, status TEXT NOT NULL, reserve_transaction_id TEXT REFERENCES token_transactions(id), settlement_transaction_id TEXT REFERENCES token_transactions(id), expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, settled_at INTEGER, UNIQUE(user_id, operation_key));
    CREATE TABLE generation_job_events (id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES generation_jobs(id), attempt_id TEXT, provider_id TEXT, provider_event_id TEXT, operation_key TEXT NOT NULL, source TEXT NOT NULL, event_type TEXT NOT NULL, from_status TEXT, to_status TEXT, payload TEXT, created_at INTEGER NOT NULL, UNIQUE(job_id, operation_key));
    CREATE TABLE generation_assets (id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES generation_jobs(id), attempt_id TEXT, kind TEXT NOT NULL, storage TEXT NOT NULL, object_key TEXT NOT NULL, content_type TEXT, byte_size INTEGER, checksum TEXT, status TEXT NOT NULL, created_at INTEGER NOT NULL, ready_at INTEGER);
  `);

  const now = Date.now();
  const userId = "user-generation";
  const templateId = "template-pvideo";
  const versionId = "version-pvideo-v1";
  const pricingId = "pricing-pvideo-v1";
  const quoteId = "quote-pvideo-v1";
  const inputs = { prompt: "red sports car", durationSec: 1, aspectRatio: "16:9", resolution: "720p" };
  const normalizedInputs = { ...inputs, fps: 24, draft: true, promptUpsampling: true, includeGeneratedAudio: false };
  const configurationSnapshot = {
    schemaVersion: 1,
    pipelineType: "p_video",
    template: { id: versionId, version: 1 },
    pricing: { id: pricingId },
    provider: { id: "provider-replicate", key: "replicate" },
    model: { id: "model-pvideo", key: "prunaai/p-video", versionId: "model-version-pvideo", versionRef: "digest" },
    testMode: true,
    inputMapping: { prompt: "prompt" },
  };
  const quote = {
    quoteId,
    templateVersionId: versionId,
    pricingVersionId: pricingId,
    creditAmount: 5,
    estimatedDurationSec: { min: 15, max: 180 },
    expiresAt: now + 600_000,
  };
  const storedQuote = {
    quote,
    userId,
    request: { templateVersionId: versionId, inputs },
    normalizedInputs,
    configurationSnapshot,
    templateId,
    estimatedCostMicros: 1_000,
  };

  await db.prepare("INSERT INTO user VALUES (?,?,?)").bind(userId, 25, now).run();
  await db.prepare("INSERT INTO templates VALUES (?)").bind(templateId).run();
  await db.prepare("INSERT INTO template_versions VALUES (?)").bind(versionId).run();
  await db.prepare("INSERT INTO pricing_versions VALUES (?)").bind(pricingId).run();
  await db.prepare("INSERT INTO generation_quotes VALUES (?,?,?,?,?)")
    .bind(quoteId, userId, JSON.stringify(storedQuote), quote.expiresAt, now).run();

  const env = {
    DB: db,
    P_VIDEO_GENERATION: {
      create: async () => ({ id: "workflow" }),
      get: async () => ({ status: async () => ({ status: "running" }) }),
    },
  };
  const result = await createGenerationJob(
    env,
    userId,
    "request-generation-v1",
    { templateVersionId: versionId, inputs, quoteId, idempotencyKey: "generation-test-v1" },
    "generation-test-v1",
  );

  assert.equal(result.job.status, "queued");
  assert.equal(result.job.quotedCredits, 5);
  assert.equal((await db.prepare("SELECT tokens FROM user WHERE id=?").bind(userId).first()).tokens, 20);
  const reservation = await db.prepare("SELECT status,reserve_transaction_id FROM credit_reservations WHERE job_id=?").bind(result.job.id).first();
  assert.equal(reservation.status, "reserved");
  assert.ok(reservation.reserve_transaction_id);
  assert.equal((await db.prepare("SELECT amount FROM token_transactions WHERE id=?").bind(reservation.reserve_transaction_id).first()).amount, -5);
  assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM generation_job_events WHERE job_id=?").bind(result.job.id).first()).count, 2);

  const completedAt = now + 5_000;
  const assetId = "asset-generation-master";
  await db.prepare("UPDATE generation_jobs SET status='completed',progress=100,updated_at=?,completed_at=? WHERE id=?")
    .bind(completedAt, completedAt, result.job.id).run();
  await db.prepare("INSERT INTO generation_assets VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
    .bind(
      assetId,
      result.job.id,
      null,
      "video_master",
      "r2",
      `users/${userId}/generation-jobs/${result.job.id}/master.mp4`,
      "video/mp4",
      1_024,
      "etag-master",
      "ready",
      completedAt,
      completedAt,
    ).run();

  const completed = await getGenerationJob(env, userId, result.job.id);
  assert.equal(completed.status, "completed");
  assert.equal(completed.progress, 100);
  assert.equal(completed.videoAssetId, assetId);
  assert.equal(completed.completedAt, completedAt);

  const history = await listGenerationJobs(env, userId, { status: "completed", limit: 20 });
  assert.equal(history.items.length, 1);
  assert.equal(history.items[0].id, result.job.id);
  assert.equal(history.items[0].videoAssetId, assetId);
});

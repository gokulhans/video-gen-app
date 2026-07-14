import assert from "node:assert/strict";
import test from "node:test";

import { Miniflare } from "miniflare";

import {
  capturePVideoReservationAndComplete,
  insertPVideoOutcomeNotification,
  recordPVideoMasterAsset,
} from "../.test-dist/workflows/p-video-persistence.js";

test("successful P-Video persistence captures credits, exposes a ready asset, and notifies exactly once", async (t) => {
  const mf = new Miniflare({
    modules: true,
    script: "export default { fetch(){ return new Response('ok') } }",
    compatibilityDate: "2026-07-08",
    d1Databases: { DB: "p-video-success-test" },
  });
  t.after(async () => mf.dispose());
  const db = await mf.getD1Database("DB");
  await db.exec(`
    CREATE TABLE user (id TEXT PRIMARY KEY, tokens INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE projects (id TEXT PRIMARY KEY);
    CREATE TABLE generation_jobs (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES user(id), project_id TEXT REFERENCES projects(id), status TEXT NOT NULL, progress INTEGER NOT NULL, error_code TEXT, error_message TEXT, completed_at INTEGER, updated_at INTEGER NOT NULL);
    CREATE TABLE generation_attempts (id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES generation_jobs(id));
    CREATE TABLE token_transactions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES user(id), amount INTEGER NOT NULL, type TEXT NOT NULL, description TEXT, project_id TEXT REFERENCES projects(id), operation_key TEXT UNIQUE, created_at INTEGER NOT NULL);
    CREATE TABLE credit_reservations (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES user(id), job_id TEXT NOT NULL UNIQUE REFERENCES generation_jobs(id), amount INTEGER NOT NULL, status TEXT NOT NULL, reserve_transaction_id TEXT REFERENCES token_transactions(id), settlement_transaction_id TEXT REFERENCES token_transactions(id), settled_at INTEGER, updated_at INTEGER NOT NULL);
    CREATE TABLE generation_job_events (id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES generation_jobs(id), operation_key TEXT NOT NULL, source TEXT NOT NULL, event_type TEXT NOT NULL, from_status TEXT, to_status TEXT, payload TEXT, created_at INTEGER NOT NULL, UNIQUE(job_id, operation_key));
    CREATE TABLE generation_assets (id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES generation_jobs(id), attempt_id TEXT REFERENCES generation_attempts(id), kind TEXT NOT NULL, storage TEXT NOT NULL, object_key TEXT NOT NULL, content_type TEXT, byte_size INTEGER, checksum TEXT, status TEXT NOT NULL, created_at INTEGER NOT NULL, ready_at INTEGER, UNIQUE(storage, object_key));
    CREATE TABLE notifications (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES user(id), type TEXT NOT NULL, title TEXT NOT NULL, message TEXT NOT NULL, project_id TEXT REFERENCES projects(id), job_id TEXT REFERENCES generation_jobs(id), deep_link TEXT, dedupe_key TEXT UNIQUE, metadata TEXT, is_read INTEGER NOT NULL, push_sent INTEGER NOT NULL, email_sent INTEGER NOT NULL, created_at INTEGER NOT NULL);
  `);

  const now = Date.now();
  const context = { jobId: "job-success", userId: "user-success", projectId: "project-success" };
  await db.batch([
    db.prepare("INSERT INTO user VALUES (?,?,?)").bind(context.userId, 20, now),
    db.prepare("INSERT INTO projects VALUES (?)").bind(context.projectId),
    db.prepare("INSERT INTO generation_jobs VALUES (?,?,?,?,?,?,?,?,?)")
      .bind(context.jobId, context.userId, context.projectId, "publishing", 95, null, null, null, now),
    db.prepare("INSERT INTO generation_attempts VALUES (?,?)").bind("attempt-success", context.jobId),
    db.prepare("INSERT INTO token_transactions VALUES (?,?,?,?,?,?,?,?)")
      .bind("tx-reserve", context.userId, -5, "generation_reserve", "Reserved credits", context.projectId, "reserve", now),
    db.prepare("INSERT INTO credit_reservations VALUES (?,?,?,?,?,?,?,?,?)")
      .bind("reservation-success", context.userId, context.jobId, 5, "reserved", "tx-reserve", null, null, now),
  ]);

  const stored = {
    key: `users/${context.userId}/generation-jobs/${context.jobId}/master.mp4`,
    contentType: "video/mp4",
    bytes: 4,
    etag: "etag-success",
  };
  await recordPVideoMasterAsset(db, context, "attempt-success", stored, now + 1);
  await capturePVideoReservationAndComplete(db, context, now + 2);
  await insertPVideoOutcomeNotification(db, context, context.projectId, true, now + 3);

  // Workflow step replay must remain exactly once and preserve the terminal result.
  await recordPVideoMasterAsset(db, context, "attempt-success", stored, now + 4);
  await capturePVideoReservationAndComplete(db, context, now + 5);
  await insertPVideoOutcomeNotification(db, context, context.projectId, true, now + 6);

  assert.deepEqual(
    await db.prepare("SELECT status,progress,error_code,error_message FROM generation_jobs WHERE id=?").bind(context.jobId).first(),
    { status: "completed", progress: 100, error_code: null, error_message: null },
  );
  assert.deepEqual(
    await db.prepare("SELECT status,settlement_transaction_id FROM credit_reservations WHERE job_id=?").bind(context.jobId).first(),
    { status: "captured", settlement_transaction_id: `tx_capture_${context.jobId}` },
  );
  assert.equal((await db.prepare("SELECT tokens FROM user WHERE id=?").bind(context.userId).first()).tokens, 20);
  assert.deepEqual(
    await db.prepare("SELECT kind,storage,object_key,status,byte_size,checksum FROM generation_assets WHERE job_id=?").bind(context.jobId).first(),
    { kind: "video_master", storage: "r2", object_key: stored.key, status: "ready", byte_size: 4, checksum: "etag-success" },
  );
  assert.deepEqual(
    await db.prepare("SELECT type,title,deep_link,is_read FROM notifications WHERE job_id=?").bind(context.jobId).first(),
    { type: "generation_complete", title: "Your video is ready", deep_link: `/generation/${context.jobId}`, is_read: 0 },
  );
  assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM token_transactions WHERE operation_key=?").bind(`generation:${context.jobId}:capture`).first()).count, 1);
  assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM generation_job_events WHERE operation_key='transition:publishing:completed'").first()).count, 1);
  assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM notifications WHERE job_id=?").bind(context.jobId).first()).count, 1);
});

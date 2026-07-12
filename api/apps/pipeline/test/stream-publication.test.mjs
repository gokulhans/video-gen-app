import assert from "node:assert/strict";
import test from "node:test";
import {
  isPersistedStreamUid,
  findStreamRecoveryCandidate,
  normalizeStreamUid,
  matchesStreamRecoveryCandidate,
  streamRecoveryWindow,
  streamLifecycleState,
  streamPendingObjectKey,
} from "../.test-dist/workflows/stream-publication.js";

test("Stream response IDs normalize across binding and legacy response shapes", () => {
  assert.equal(normalizeStreamUid({ id: "stream_id_123" }), "stream_id_123");
  assert.equal(normalizeStreamUid({ uid: "stream_uid_123" }), "stream_uid_123");
  assert.equal(normalizeStreamUid({ id: "bad/id" }), null);
});

test("remote upload recovery is tenant/job exact and null-safe before UID persistence", () => {
  assert.equal(matchesStreamRecoveryCandidate({ creator: "user_1", meta: { generationJobId: "job_1" } }, "user_1", "job_1"), true);
  assert.equal(matchesStreamRecoveryCandidate({ creator: "user_2", meta: { generationJobId: "job_1" } }, "user_1", "job_1"), false);
  assert.equal(matchesStreamRecoveryCandidate({ creator: "user_1", meta: null }, "user_1", "job_1"), false);
  assert.deepEqual(findStreamRecoveryCandidate([
    { id: "wrong", creator: "user_2", meta: { generationJobId: "job_1" } },
    { id: "accepted-before-d1", creator: "user_1", meta: { generationJobId: "job_1" } },
  ], "user_1", "job_1"), {
    id: "accepted-before-d1", creator: "user_1", meta: { generationJobId: "job_1" },
  });
  assert.deepEqual(streamRecoveryWindow(120_000, 180_000), {
    after: "1970-01-01T00:01:00.000Z",
    before: "1970-01-01T00:04:00.000Z",
  });
  assert.equal(streamRecoveryWindow(120_000, 86_400_000).before, "1970-01-01T00:23:00.000Z");
});

test("pending asset locator cannot be mistaken for a persisted Stream UID", () => {
  assert.equal(streamPendingObjectKey("job_12345678"), "pending:job_12345678");
  assert.equal(isPersistedStreamUid("pending:job_12345678", "job_12345678"), false);
  assert.equal(isPersistedStreamUid("stream_uid_123", "job_12345678"), true);
});

test("Stream readiness is terminal only for ready or failed states", () => {
  assert.equal(streamLifecycleState(true, "ready"), "ready");
  assert.equal(streamLifecycleState(false, "downloading"), "processing");
  assert.equal(streamLifecycleState(false, "error"), "failed");
});

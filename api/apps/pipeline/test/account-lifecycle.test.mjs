import assert from "node:assert/strict";
import test from "node:test";
import {
  deletionClaimMatches,
  exportWithinLimits,
  shouldContinuePrefixSweep,
  streamDeleteIsAlreadyGone,
} from "../.test-dist/workflows/account-lifecycle-policy.js";

test("deletion claim closes cancellation and duplicate-workflow races", () => {
  const scheduled = { status: "scheduled", workflowInstanceId: "wf-1", scheduledFor: 100 };
  assert.equal(deletionClaimMatches(scheduled, "wf-1", 100), true);
  assert.equal(deletionClaimMatches({ ...scheduled, status: "cancelled" }, "wf-1", 101), false);
  assert.equal(deletionClaimMatches(scheduled, "wf-2", 101), false);
  assert.equal(deletionClaimMatches(scheduled, "wf-1", 99), false);
});

test("export cap fails before oversized manifest publication", () => {
  assert.equal(exportWithinLimits(4_000, 750_000), true);
  assert.equal(exportWithinLimits(4_001, 100), false);
  assert.equal(exportWithinLimits(1, 750_001), false);
});

test("prefix cleanup continues until an empty page and Stream 404 is idempotent", () => {
  assert.equal(shouldContinuePrefixSweep(1000), true);
  assert.equal(shouldContinuePrefixSweep(0), false);
  assert.equal(streamDeleteIsAlreadyGone(new Error("404 video not found")), true);
  assert.equal(streamDeleteIsAlreadyGone(new Error("503 upstream unavailable")), false);
});

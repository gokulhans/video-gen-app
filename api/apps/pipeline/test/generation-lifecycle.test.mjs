import assert from "node:assert/strict";
import { test } from "node:test";
import {
  settlementDecision,
  transitionDecision,
} from "../.test-dist/workflows/generation-lifecycle.js";

test("generation transitions distinguish apply, replay, and invalid state", () => {
  assert.equal(transitionDecision("queued", "queued", "submitting"), "apply");
  assert.equal(transitionDecision("submitting", "queued", "submitting"), "already_applied");
  assert.equal(transitionDecision("completed", "queued", "submitting"), "reject");
});

test("credit settlement is exactly-once and mutually exclusive", () => {
  assert.equal(settlementDecision("reserved", "captured"), "apply");
  assert.equal(settlementDecision("captured", "captured"), "already_applied");
  assert.equal(settlementDecision("released", "captured"), "reject");
  assert.equal(settlementDecision("reserved", "released"), "apply");
  assert.equal(settlementDecision("released", "released"), "already_applied");
  assert.equal(settlementDecision("captured", "released"), "reject");
});

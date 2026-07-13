import assert from "node:assert/strict";
import test from "node:test";
import { isReapableRenderJob, stuckRenderCutoff } from "../src/reaper-policy.ts";

test("render reaper claims only stale non-terminal jobs", () => {
	const now = 2_000_000;
	const cutoff = stuckRenderCutoff(now);
	assert.equal(isReapableRenderJob("queued", cutoff - 1, now), true);
	assert.equal(isReapableRenderJob("rendering", cutoff - 1, now), true);
	assert.equal(isReapableRenderJob("rendering", cutoff, now), false);
	assert.equal(isReapableRenderJob("completed", cutoff - 1, now), false);
	assert.equal(isReapableRenderJob("failed", cutoff - 1, now), false);
});

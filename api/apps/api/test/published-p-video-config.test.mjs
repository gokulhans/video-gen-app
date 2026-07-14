import assert from "node:assert/strict";
import test from "node:test";

import { parsePublishedPVideoConfig } from "../src/services/generation.ts";

const baseConfig = {
  provider: "replicate",
  model: "prunaai/p-video",
  modelVersion: "68b33d8ba1189a1a997abf2c09edc5bbb90d6cfa239befbf9c903bcfee7f9a59",
  mode: "test",
  defaults: {
    durationSec: 1,
    aspectRatio: "16:9",
    resolution: "720p",
    fps: 24,
    draft: true,
    promptUpsampling: true,
    includeGeneratedAudio: false,
  },
};

test("legacy published P-Video safety marker remains usable and is stripped", () => {
  const parsed = parsePublishedPVideoConfig({
    ...baseConfig,
    defaults: { ...baseConfig.defaults, safetyFilterEnabled: true },
  });

  assert.equal(parsed.success, true);
  assert.deepEqual(parsed.data.defaults, baseConfig.defaults);
});

test("published P-Video configuration cannot disable the safety marker", () => {
  const parsed = parsePublishedPVideoConfig({
    ...baseConfig,
    defaults: { ...baseConfig.defaults, safetyFilterEnabled: false },
  });

  assert.equal(parsed.success, false);
});

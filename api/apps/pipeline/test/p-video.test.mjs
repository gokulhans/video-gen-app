import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  P_VIDEO_VERSION,
  createPVideoPrediction,
  normalizePVideoInput,
  pVideoOutputUrl,
  storePVideoOutput,
  toPVideoProviderInput,
  waitForPVideoPrediction,
} from "../.test-dist/p-video.js";
import { fetchReplicateDelivery, ReplicateProviderError } from "../.test-dist/replicate.js";

const originalFetch = globalThis.fetch;
const env = { REPLICATE_API_TOKEN: "test-token" };

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function prediction(overrides = {}) {
  return {
    id: "abc123",
    version: P_VIDEO_VERSION,
    status: "succeeded",
    output: "https://replicate.delivery/output.mp4",
    urls: {
      get: "https://api.replicate.com/v1/predictions/abc123",
      cancel: "https://api.replicate.com/v1/predictions/abc123/cancel",
    },
    ...overrides,
  };
}

test("normalizes the cheap test profile with safety enabled", () => {
  assert.deepEqual(normalizePVideoInput({ prompt: "A paper boat" }), {
    prompt: "A paper boat",
    duration: 1,
    aspectRatio: "16:9",
    resolution: "720p",
    fps: 24,
    draft: true,
    promptUpsampling: true,
    disableSafetyFilter: false,
    saveAudio: false,
  });
  assert.deepEqual(toPVideoProviderInput({ prompt: "A paper boat" }), {
    prompt: "A paper boat",
    duration: 1,
    aspect_ratio: "16:9",
    resolution: "720p",
    fps: 24,
    draft: true,
    prompt_upsampling: true,
    disable_safety_filter: false,
    save_audio: false,
  });
});

test("omits provider-ignored controls and cannot disable safety", () => {
  const audio = toPVideoProviderInput({
    prompt: "A product reveal",
    audio: "https://assets.example.test/voice.wav",
  });
  assert.equal("duration" in audio, false);
  assert.equal(audio.aspect_ratio, "16:9");

  const image = toPVideoProviderInput({
    prompt: "Animate this product",
    image: "https://assets.example.test/product.png",
  });
  assert.equal("aspect_ratio" in image, false);
  assert.equal(image.duration, 1);

  assert.throws(
    () => normalizePVideoInput({ prompt: "Unsafe override", disableSafetyFilter: true }),
    (error) => error?.name === "ZodError",
  );
});

test("creates one pinned paid prediction and persists the returned version", async () => {
  const requests = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ input: String(input), init });
    return Response.json(prediction());
  };

  const result = await createPVideoPrediction(env, { prompt: "A paper boat" });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].input, "https://api.replicate.com/v1/predictions");
  assert.equal(requests[0].init.method, "POST");
  assert.equal(requests[0].init.headers.Authorization, "Bearer test-token");
  const body = JSON.parse(requests[0].init.body);
  assert.equal(body.version, P_VIDEO_VERSION);
  assert.equal(body.input.duration, 1);
  assert.equal(body.input.draft, true);
  assert.equal(body.input.disable_safety_filter, false);
  assert.equal(result.version, P_VIDEO_VERSION);
});

test("requires P-Video's single URI output contract", async () => {
  assert.throws(
    () => pVideoOutputUrl({ ...prediction(), output: ["https://replicate.delivery/a.mp4"] }),
    (error) => error instanceof ReplicateProviderError && error.code === "invalid_response",
  );
  await assert.rejects(
    waitForPVideoPrediction(env, { ...prediction(), version: "f".repeat(64) }),
    (error) => error instanceof ReplicateProviderError && error.code === "invalid_response",
  );
});

test("rejects an untrusted delivery host before making a request", async () => {
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return new Response();
  };
  await assert.rejects(
    fetchReplicateDelivery("https://replicate.delivery.evil.example/video.mp4", 1_000),
    (error) => error instanceof ReplicateProviderError && error.code === "invalid_response",
  );
  assert.equal(called, false);
});

test("streams MP4 to R2 within the bound and sends no delivery authorization", async () => {
  let deliveryInit;
  globalThis.fetch = async (_input, init) => {
    deliveryInit = init;
    return new Response(new Uint8Array([1, 2, 3, 4]), {
      headers: { "content-type": "video/mp4", "content-length": "4" },
    });
  };
  let storedBody;
  let storedOptions;
  const bucket = {
    async put(_key, body, options) {
      storedBody = new Uint8Array(await new Response(body).arrayBuffer());
      storedOptions = options;
      return { etag: "etag-1" };
    },
  };

  const stored = await storePVideoOutput(
    bucket,
    "users/u/jobs/j/output.mp4",
    "https://files.replicate.delivery/output.mp4",
    P_VIDEO_VERSION,
    { maxBytes: 4 },
  );
  assert.equal(deliveryInit.method, "GET");
  assert.equal(deliveryInit.headers, undefined);
  assert.deepEqual(storedBody, new Uint8Array([1, 2, 3, 4]));
  assert.equal(storedOptions.httpMetadata.contentType, "video/mp4");
  assert.equal(stored.bytes, 4);
  assert.equal(stored.version, P_VIDEO_VERSION);
});

test("rejects declared video sizes above the configured bound without writing R2", async () => {
  globalThis.fetch = async () => new Response(new Uint8Array([1]), {
    headers: { "content-type": "video/mp4", "content-length": "5" },
  });
  let writes = 0;
  const bucket = { async put() { writes += 1; return { etag: "unexpected" }; } };
  await assert.rejects(
    storePVideoOutput(bucket, "output.mp4", "https://replicate.delivery/output.mp4", P_VIDEO_VERSION, { maxBytes: 4 }),
    (error) => error instanceof ReplicateProviderError && error.code === "invalid_response",
  );
  assert.equal(writes, 0);
});

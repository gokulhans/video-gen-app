import { z } from "zod";
import type { PipelineEnv } from "./openai.js";
import {
  createReplicatePrediction,
  fetchReplicateDelivery,
  ReplicateProviderError,
  waitForReplicatePrediction,
  type ReplicatePredictionRef,
} from "./replicate.js";

export const P_VIDEO_MODEL = "prunaai/p-video";
export const P_VIDEO_VERSION = "68b33d8ba1189a1a997abf2c09edc5bbb90d6cfa239befbf9c903bcfee7f9a59";
export const DEFAULT_MAX_P_VIDEO_BYTES = 250 * 1024 * 1024;

const OptionalUri = z.string().url().startsWith("https://").optional();

/** Product-facing P-Video input. Provider snake_case is kept inside this adapter. */
export const PVideoInputSchema = z.object({
  prompt: z.string().trim().min(1).max(5_000),
  image: OptionalUri,
  audio: OptionalUri,
  lastFrameImage: OptionalUri,
  duration: z.number().int().min(1).max(20).default(1),
  aspectRatio: z.enum(["16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "1:1"]).default("16:9"),
  resolution: z.enum(["720p", "1080p"]).default("720p"),
  fps: z.union([z.literal(24), z.literal(48)]).default(24),
  draft: z.boolean().default(true),
  promptUpsampling: z.boolean().default(true),
  // P-Video's provider default disables filtering. The application adapter
  // deliberately makes that state unrepresentable for user/template input.
  disableSafetyFilter: z.literal(false).default(false),
  saveAudio: z.boolean().default(false),
  seed: z.number().int().nonnegative().optional(),
});

export type PVideoInput = z.input<typeof PVideoInputSchema>;
export type NormalizedPVideoInput = z.output<typeof PVideoInputSchema>;

export type StoredPVideo = {
  key: string;
  version: string;
  contentType: "video/mp4";
  bytes: number;
  etag: string;
};

/** Deterministic mapping used by API/admin contracts and unit tests. */
export function normalizePVideoInput(input: PVideoInput): NormalizedPVideoInput {
  return PVideoInputSchema.parse(input);
}

export function toPVideoProviderInput(input: PVideoInput): Record<string, unknown> {
  const value = normalizePVideoInput(input);
  return {
    prompt: value.prompt,
    // Provider schema ignores duration when audio is supplied and ignores the
    // aspect ratio when an image establishes the canvas. Omit those fields so
    // the persisted request accurately describes what the provider executes.
    ...(!value.audio ? { duration: value.duration } : {}),
    ...(!value.image ? { aspect_ratio: value.aspectRatio } : {}),
    resolution: value.resolution,
    fps: value.fps,
    draft: value.draft,
    prompt_upsampling: value.promptUpsampling,
    disable_safety_filter: value.disableSafetyFilter,
    save_audio: value.saveAudio,
    ...(value.image ? { image: value.image } : {}),
    ...(value.audio ? { audio: value.audio } : {}),
    ...(value.lastFrameImage ? { last_frame_image: value.lastFrameImage } : {}),
    ...(value.seed !== undefined ? { seed: value.seed } : {}),
  };
}

/** Create exactly one pinned paid P-Video prediction; this function never retries. */
export async function createPVideoPrediction(
  env: PipelineEnv,
  input: PVideoInput,
  cancelAfterSeconds = 300,
): Promise<ReplicatePredictionRef> {
  const prediction = await createReplicatePrediction(env, {
    model: P_VIDEO_MODEL,
    version: P_VIDEO_VERSION,
    input: toPVideoProviderInput(input),
    cancelAfterSeconds,
    preferWaitSeconds: 10,
  });
  if (prediction.version !== P_VIDEO_VERSION) {
    throw new ReplicateProviderError("Video provider used an unexpected model version", "invalid_response", prediction.id);
  }
  return prediction;
}

/** P-Video's output contract is one URI, not an array of assets. */
export function pVideoOutputUrl(prediction: ReplicatePredictionRef): string {
  const output = z.string().url().safeParse(prediction.output);
  if (!output.success) {
    throw new ReplicateProviderError("Video provider returned an invalid output", "invalid_response", prediction.id);
  }
  return output.data;
}

/** Poll only the already-paid prediction and return its single output URI. */
export async function waitForPVideoPrediction(
  env: PipelineEnv,
  initial: ReplicatePredictionRef,
  timeoutMs = 5 * 60_000,
): Promise<string> {
  const prediction = initial.status === "succeeded"
    ? initial
    : await waitForReplicatePrediction(env, initial, timeoutMs);
  if (prediction.status !== "succeeded") {
    throw new ReplicateProviderError("Video generation failed", "prediction_failed", prediction.id);
  }
  if (prediction.version !== P_VIDEO_VERSION) {
    throw new ReplicateProviderError("Video provider used an unexpected model version", "invalid_response", prediction.id);
  }
  return pVideoOutputUrl(prediction);
}

function boundedVideoStream(body: ReadableStream<Uint8Array>, maxBytes: number, onBytes: (bytes: number) => void): ReadableStream<Uint8Array> {
  let bytes = 0;
  return body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      bytes += chunk.byteLength;
      if (bytes > maxBytes) {
        throw new ReplicateProviderError("Generated video exceeded the size limit", "invalid_response");
      }
      controller.enqueue(chunk);
    },
    flush() {
      if (bytes === 0) {
        throw new ReplicateProviderError("Generated video was empty", "invalid_response");
      }
      onBytes(bytes);
    },
  }));
}

/**
 * Stream a delivery asset directly into R2. No ArrayBuffer is created and no
 * Replicate Authorization header is sent to the delivery host.
 */
export async function storePVideoOutput(
  bucket: R2Bucket,
  key: string,
  outputUrl: string,
  version: string,
  options: { maxBytes?: number; downloadTimeoutMs?: number } = {},
): Promise<StoredPVideo> {
  if (version !== P_VIDEO_VERSION) {
    throw new ReplicateProviderError("Refusing to store output from an unexpected model version", "invalid_response");
  }
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_P_VIDEO_BYTES;
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new ReplicateProviderError("Video size limit is invalid", "invalid_response");
  }

  const response = await fetchReplicateDelivery(outputUrl, options.downloadTimeoutMs ?? 60_000);
  if (!response.ok || !response.body) {
    await response.body?.cancel("delivery failed");
    console.error(JSON.stringify({ event: "replicate_video_download_failed", status: response.status }));
    throw new ReplicateProviderError("Generated video could not be downloaded", "provider_unavailable");
  }
  const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "video/mp4") {
    await response.body.cancel("unexpected video content type");
    throw new ReplicateProviderError("Video provider returned an unexpected file type", "invalid_response");
  }
  const contentLengthHeader = response.headers.get("content-length");
  if (contentLengthHeader !== null) {
    const contentLength = Number(contentLengthHeader);
    if (!Number.isFinite(contentLength) || contentLength <= 0 || contentLength > maxBytes) {
      await response.body.cancel("video content length is invalid");
      throw new ReplicateProviderError("Generated video had an invalid size", "invalid_response");
    }
  }

  let bytes = 0;
  const stream = boundedVideoStream(response.body, maxBytes, (count) => { bytes = count; });
  const stored = await bucket.put(key, stream, {
    httpMetadata: { contentType: "video/mp4" },
    customMetadata: { provider: "replicate", model: P_VIDEO_MODEL, version },
  });
  return { key, version, contentType: "video/mp4", bytes, etag: stored.etag };
}

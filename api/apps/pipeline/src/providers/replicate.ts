import { z } from "zod";
import type { PipelineEnv } from "./openai.js";

const REPLICATE_API = "https://api.replicate.com/v1";
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const MAX_ERROR_BODY_CHARS = 2_000;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

const PredictionSchema = z.object({
  id: z.string().min(1),
  status: z.enum(["starting", "processing", "succeeded", "failed", "canceled", "aborted"]),
  output: z.unknown().nullable().optional(),
  error: z.string().nullable().optional(),
  urls: z.object({
    get: z.string().url().optional(),
    cancel: z.string().url().optional(),
  }).optional(),
});

export type ReplicatePrediction = z.infer<typeof PredictionSchema>;
export type ReplicatePredictionRef = {
  id: string;
  status: ReplicatePrediction["status"];
  getUrl?: string;
  cancelUrl?: string;
  outputUrl?: string;
};

export class ReplicateProviderError extends Error {
  constructor(
    message: string,
    readonly code: "provider_unavailable" | "invalid_response" | "prediction_failed" | "prediction_timeout",
    readonly predictionId?: string,
  ) {
    super(message);
    this.name = "ReplicateProviderError";
  }
}

function authorization(env: PipelineEnv): string {
  if (!env.REPLICATE_API_TOKEN) {
    throw new ReplicateProviderError("Image generation is temporarily unavailable", "provider_unavailable");
  }
  return `Bearer ${env.REPLICATE_API_TOKEN}`;
}

async function fetchWithDeadline(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("request timeout"), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function boundedErrorBody(response: Response): Promise<string> {
  const value = await response.text().catch(() => "");
  return value.slice(0, MAX_ERROR_BODY_CHARS);
}

function retryAfterMs(response: Response, attempt: number): number {
  const raw = response.headers.get("retry-after");
  if (raw) {
    const seconds = Number(raw);
    if (Number.isFinite(seconds)) return Math.min(10_000, Math.max(0, seconds * 1_000));
    const date = Date.parse(raw);
    if (Number.isFinite(date)) return Math.min(10_000, Math.max(0, date - Date.now()));
  }
  const base = Math.min(8_000, 500 * 2 ** attempt);
  return base + Math.floor(Math.random() * Math.max(1, Math.floor(base / 4)));
}

async function getPrediction(env: PipelineEnv, url: string, deadlineMs: number): Promise<ReplicatePrediction> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 5 && Date.now() < deadlineMs; attempt++) {
    try {
      const response = await fetchWithDeadline(url, {
        headers: { Authorization: authorization(env) },
      }, Math.min(DEFAULT_REQUEST_TIMEOUT_MS, Math.max(1, deadlineMs - Date.now())));
      if (response.ok) return PredictionSchema.parse(await response.json());
      if (response.status !== 408 && response.status !== 429 && response.status < 500) {
        console.error(JSON.stringify({ event: "replicate_poll_rejected", status: response.status, body: await boundedErrorBody(response) }));
        throw new ReplicateProviderError("Image generation status could not be retrieved", "provider_unavailable");
      }
      lastError = new Error(`Replicate poll returned ${response.status}`);
      await new Promise((resolve) => setTimeout(resolve, retryAfterMs(response, attempt)));
    } catch (error) {
      if (error instanceof ReplicateProviderError) throw error;
      lastError = error;
      const delay = Math.min(8_000, 500 * 2 ** attempt) + Math.floor(Math.random() * 250);
      if (Date.now() + delay < deadlineMs) await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  console.error(JSON.stringify({ event: "replicate_poll_exhausted", error: String(lastError) }));
  throw new ReplicateProviderError("Image generation status is temporarily unavailable", "provider_unavailable");
}

async function cancelPrediction(env: PipelineEnv, prediction: ReplicatePrediction): Promise<void> {
  const cancelUrl = prediction.urls?.cancel ?? `${REPLICATE_API}/predictions/${encodeURIComponent(prediction.id)}/cancel`;
  try {
    await fetchWithDeadline(cancelUrl, {
      method: "POST",
      headers: { Authorization: authorization(env) },
    }, 10_000);
  } catch (error) {
    console.error(JSON.stringify({ event: "replicate_cancel_failed", predictionId: prediction.id, error: String(error) }));
  }
}

/** Create one paid Flux prediction. Keep this in its own Workflow step. */
export async function createFluxPrediction(
  env: PipelineEnv,
  params: { prompt: string; aspectRatio?: "9:16" | "1:1" | "16:9"; cancelAfterSeconds?: number },
): Promise<ReplicatePredictionRef> {
  const cancelAfterSeconds = Math.min(300, Math.max(15, params.cancelAfterSeconds ?? 90));
  const response = await fetchWithDeadline(`${REPLICATE_API}/models/black-forest-labs/flux-schnell/predictions`, {
    method: "POST",
    headers: {
      Authorization: authorization(env),
      "Content-Type": "application/json",
      "Cancel-After": `${cancelAfterSeconds}s`,
      Prefer: "wait=10",
    },
    body: JSON.stringify({
      input: {
        prompt: params.prompt,
        aspect_ratio: params.aspectRatio ?? "9:16",
        output_format: "webp",
        num_outputs: 1,
      },
    }),
  });
  if (!response.ok) {
    console.error(JSON.stringify({ event: "replicate_create_rejected", model: "black-forest-labs/flux-schnell", status: response.status, body: await boundedErrorBody(response) }));
    throw new ReplicateProviderError("Image generation could not be started", "provider_unavailable");
  }
  try {
    const prediction = PredictionSchema.parse(await response.json());
    return toPredictionRef(prediction);
  } catch (error) {
    console.error(JSON.stringify({ event: "replicate_create_invalid_response", error: String(error) }));
    throw new ReplicateProviderError("Image provider returned an invalid response", "invalid_response");
  }
}

/** Poll an existing prediction. Retrying this function never creates another paid prediction. */
export async function waitForFluxPrediction(
  env: PipelineEnv,
  initial: ReplicatePredictionRef,
  timeoutMs = 90_000,
): Promise<string> {
  const deadlineMs = Date.now() + timeoutMs;
  let current = initial;
  const getUrl = current.getUrl ?? `${REPLICATE_API}/predictions/${encodeURIComponent(current.id)}`;

  if (current.status === "succeeded" && current.outputUrl) return current.outputUrl;

  while (current.status === "starting" || current.status === "processing") {
    if (Date.now() >= deadlineMs) {
      await cancelPrediction(env, {
        id: current.id,
        status: current.status,
        urls: { get: current.getUrl, cancel: current.cancelUrl },
      });
      throw new ReplicateProviderError("Image generation timed out", "prediction_timeout", current.id);
    }
    const delay = Math.min(5_000, 1_000 + Math.floor((timeoutMs - (deadlineMs - Date.now())) / 10_000) * 500);
    await new Promise((resolve) => setTimeout(resolve, Math.max(1_000, delay) + Math.floor(Math.random() * 250)));
    current = toPredictionRef(await getPrediction(env, getUrl, deadlineMs));
  }

  if (current.status !== "succeeded") {
    console.error(JSON.stringify({ event: "replicate_prediction_failed", predictionId: current.id, status: current.status }));
    throw new ReplicateProviderError("Image generation failed", "prediction_failed", current.id);
  }

  if (!current.outputUrl) {
    console.error(JSON.stringify({ event: "replicate_output_invalid", predictionId: current.id }));
    throw new ReplicateProviderError("Image provider returned an invalid output", "invalid_response", current.id);
  }
  return current.outputUrl;
}

function outputUrlFromValue(value: unknown): string | undefined {
  const parsed = z.union([z.string().url(), z.array(z.string().url()).min(1)]).safeParse(value);
  if (!parsed.success) return undefined;
  return Array.isArray(parsed.data) ? parsed.data[0] : parsed.data;
}

function toPredictionRef(prediction: ReplicatePrediction): ReplicatePredictionRef {
  return {
    id: prediction.id,
    status: prediction.status,
    getUrl: prediction.urls?.get,
    cancelUrl: prediction.urls?.cancel,
    outputUrl: outputUrlFromValue(prediction.output),
  };
}

function isTrustedReplicateOutput(url: URL): boolean {
  return url.protocol === "https:" && (url.hostname === "replicate.delivery" || url.hostname.endsWith(".replicate.delivery"));
}

/** Download a bounded Replicate output. Keep this separate from prediction creation. */
export async function downloadReplicateImage(env: PipelineEnv, outputUrl: string): Promise<ArrayBuffer> {
  const url = new URL(outputUrl);
  if (!isTrustedReplicateOutput(url)) {
    throw new ReplicateProviderError("Image provider returned an untrusted output URL", "invalid_response");
  }
  const response = await fetchWithDeadline(url, {
    headers: { Authorization: authorization(env) },
  }, 30_000);
  if (!response.ok) {
    console.error(JSON.stringify({ event: "replicate_output_download_failed", status: response.status, host: url.hostname }));
    throw new ReplicateProviderError("Generated image could not be downloaded", "provider_unavailable");
  }
  const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (!contentType || !["image/webp", "image/png", "image/jpeg"].includes(contentType)) {
    throw new ReplicateProviderError("Image provider returned an unexpected file type", "invalid_response");
  }
  const contentLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_IMAGE_BYTES) {
    throw new ReplicateProviderError("Generated image exceeded the size limit", "invalid_response");
  }
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new ReplicateProviderError("Generated image had an invalid size", "invalid_response");
  }
  return bytes;
}

/** Convenience wrapper for non-Workflow callers. Workflows should use the split functions above. */
export async function replicateGenerateImage(
  env: PipelineEnv,
  params: { prompt: string; aspectRatio?: "9:16" | "1:1" | "16:9"; timeoutMs?: number },
): Promise<ArrayBuffer> {
  const prediction = await createFluxPrediction(env, params);
  const outputUrl = await waitForFluxPrediction(env, prediction, params.timeoutMs ?? 90_000);
  return downloadReplicateImage(env, outputUrl);
}

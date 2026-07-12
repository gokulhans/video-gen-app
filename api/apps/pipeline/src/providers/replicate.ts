import { z } from "zod";
import type { PipelineEnv } from "./openai.js";

const REPLICATE_API = "https://api.replicate.com/v1";
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const MAX_JSON_BYTES = 256 * 1024;
const MAX_ERROR_BODY_BYTES = 2_000;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_DELIVERY_REDIRECTS = 3;

const ReplicateOutputSchema = z.union([z.string(), z.array(z.string()), z.null()]);

const PredictionSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+$/i),
  version: z.string().min(1),
  status: z.enum(["starting", "processing", "succeeded", "failed", "canceled", "aborted"]),
  output: ReplicateOutputSchema.optional(),
  error: z.string().nullable().optional(),
  urls: z.object({
    get: z.string().url().optional(),
    cancel: z.string().url().optional(),
  }).optional(),
});

export type ReplicatePrediction = z.infer<typeof PredictionSchema>;
export type ReplicateOutput = z.infer<typeof ReplicateOutputSchema>;
export type ReplicatePredictionRef = {
  id: string;
  /** The exact provider-returned model version, persisted across Workflow steps. */
  version: string;
  status: ReplicatePrediction["status"];
  getUrl?: string;
  cancelUrl?: string;
  output?: ReplicateOutput;
};

export type ReplicateCreateParams = {
  /** owner/name for official-model calls. Omit when `version` is supplied. */
  model?: string;
  /** Immutable version digest for community/version-pinned calls. */
  version?: string;
  input: Record<string, unknown>;
  cancelAfterSeconds?: number;
  preferWaitSeconds?: number;
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
    throw new ReplicateProviderError("Generation is temporarily unavailable", "provider_unavailable");
  }
  return `Bearer ${env.REPLICATE_API_TOKEN}`;
}

async function fetchWithDeadline(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("request timeout"), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return "";
  const declaredSize = response.headers.get("content-length");
  if (declaredSize !== null) {
    const parsedSize = Number(declaredSize);
    if (Number.isFinite(parsedSize) && parsedSize > maxBytes) {
      await response.body.cancel("response exceeded size limit");
      throw new ReplicateProviderError("Provider returned an oversized response", "invalid_response");
    }
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      if (bytesRead > maxBytes) {
        await reader.cancel("response exceeded size limit");
        throw new ReplicateProviderError("Provider returned an oversized response", "invalid_response");
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

async function parsePrediction(response: Response): Promise<ReplicatePrediction> {
  const text = await readBoundedText(response, MAX_JSON_BYTES);
  try {
    return PredictionSchema.parse(JSON.parse(text));
  } catch (error) {
    console.error(JSON.stringify({ event: "replicate_invalid_prediction", error: String(error) }));
    throw new ReplicateProviderError("Provider returned an invalid prediction", "invalid_response");
  }
}

async function boundedErrorBody(response: Response): Promise<string> {
  try {
    return await readBoundedText(response, MAX_ERROR_BODY_BYTES);
  } catch {
    return "<unavailable or oversized>";
  }
}

function retryAfterMs(response: Response, attempt: number): number {
  const raw = response.headers.get("retry-after");
  if (raw) {
    const seconds = Number(raw);
    if (Number.isFinite(seconds)) return Math.min(10_000, Math.max(0, seconds * 1_000));
    const date = Date.parse(raw);
    if (Number.isFinite(date)) return Math.min(10_000, Math.max(0, date - Date.now()));
  }
  return Math.min(8_000, 500 * 2 ** attempt);
}

function predictionUrl(id: string): string {
  if (!/^[a-z0-9]+$/i.test(id)) {
    throw new ReplicateProviderError("Provider returned an invalid prediction id", "invalid_response");
  }
  return `${REPLICATE_API}/predictions/${encodeURIComponent(id)}`;
}

function validateReplicateApiUrl(value: string | undefined, id: string, action: "get" | "cancel"): string | undefined {
  if (!value) return undefined;
  const url = new URL(value);
  const expectedPath = `/v1/predictions/${encodeURIComponent(id)}${action === "cancel" ? "/cancel" : ""}`;
  if (url.protocol !== "https:" || url.hostname !== "api.replicate.com" || url.port || url.username || url.password || url.pathname !== expectedPath || url.search || url.hash) {
    throw new ReplicateProviderError("Provider returned an untrusted API URL", "invalid_response", id);
  }
  return url.toString();
}

export function toPredictionRef(prediction: ReplicatePrediction): ReplicatePredictionRef {
  return {
    id: prediction.id,
    version: prediction.version,
    status: prediction.status,
    getUrl: validateReplicateApiUrl(prediction.urls?.get, prediction.id, "get"),
    cancelUrl: validateReplicateApiUrl(prediction.urls?.cancel, prediction.id, "cancel"),
    output: prediction.output,
  };
}

function createEndpoint(params: ReplicateCreateParams): { url: string; body: Record<string, unknown>; label: string } {
  if (params.version) {
    if (!/^[a-f0-9]{64}$/i.test(params.version)) {
      throw new ReplicateProviderError("A valid pinned model version is required", "invalid_response");
    }
    return {
      url: `${REPLICATE_API}/predictions`,
      body: { version: params.version, input: params.input },
      label: params.model ?? params.version,
    };
  }

  const modelParts = params.model?.match(/^([a-z0-9][a-z0-9-]*)\/([a-z0-9][a-z0-9-]*)$/i);
  if (!modelParts) {
    throw new ReplicateProviderError("A valid Replicate model or version is required", "invalid_response");
  }
  const [, owner, name] = modelParts;
  return {
    url: `${REPLICATE_API}/models/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/predictions`,
    body: { input: params.input },
    label: params.model ?? "unknown",
  };
}

/**
 * Create exactly one paid prediction. This primitive deliberately has no retry
 * loop; callers must isolate it in a Workflow step configured with zero retries.
 */
export async function createReplicatePrediction(
  env: PipelineEnv,
  params: ReplicateCreateParams,
): Promise<ReplicatePredictionRef> {
  const request = createEndpoint(params);
  const cancelAfterSeconds = Math.min(600, Math.max(15, params.cancelAfterSeconds ?? 90));
  const preferWaitSeconds = Math.min(60, Math.max(1, params.preferWaitSeconds ?? 10));
  const response = await fetchWithDeadline(request.url, {
    method: "POST",
    headers: {
      Authorization: authorization(env),
      "Content-Type": "application/json",
      "Cancel-After": `${cancelAfterSeconds}s`,
      Prefer: `wait=${preferWaitSeconds}`,
    },
    body: JSON.stringify(request.body),
  });

  if (!response.ok) {
    console.error(JSON.stringify({
      event: "replicate_create_rejected",
      model: request.label,
      status: response.status,
      body: await boundedErrorBody(response),
    }));
    throw new ReplicateProviderError("Generation could not be started", "provider_unavailable");
  }
  return toPredictionRef(await parsePrediction(response));
}

/** Retrieve an existing prediction. Transient polling failures may be retried safely. */
export async function getReplicatePrediction(
  env: PipelineEnv,
  id: string,
  deadlineMs = Date.now() + DEFAULT_REQUEST_TIMEOUT_MS,
): Promise<ReplicatePredictionRef> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 5 && Date.now() < deadlineMs; attempt++) {
    try {
      const response = await fetchWithDeadline(predictionUrl(id), {
        headers: { Authorization: authorization(env) },
      }, Math.min(DEFAULT_REQUEST_TIMEOUT_MS, Math.max(1, deadlineMs - Date.now())));
      if (response.ok) return toPredictionRef(await parsePrediction(response));
      if (response.status !== 408 && response.status !== 429 && response.status < 500) {
        console.error(JSON.stringify({ event: "replicate_poll_rejected", status: response.status, body: await boundedErrorBody(response) }));
        throw new ReplicateProviderError("Generation status could not be retrieved", "provider_unavailable", id);
      }
      lastError = new Error(`Replicate poll returned ${response.status}`);
      const delay = retryAfterMs(response, attempt);
      if (Date.now() + delay < deadlineMs) await new Promise((resolve) => setTimeout(resolve, delay));
    } catch (error) {
      if (error instanceof ReplicateProviderError) throw error;
      lastError = error;
      const delay = Math.min(8_000, 500 * 2 ** attempt);
      if (Date.now() + delay < deadlineMs) await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  console.error(JSON.stringify({ event: "replicate_poll_exhausted", predictionId: id, error: String(lastError) }));
  throw new ReplicateProviderError("Generation status is temporarily unavailable", "provider_unavailable", id);
}

async function cancelPrediction(env: PipelineEnv, prediction: ReplicatePredictionRef): Promise<void> {
  const cancelUrl = prediction.cancelUrl ?? `${predictionUrl(prediction.id)}/cancel`;
  try {
    await fetchWithDeadline(cancelUrl, {
      method: "POST",
      headers: { Authorization: authorization(env) },
    }, 10_000);
  } catch (error) {
    console.error(JSON.stringify({ event: "replicate_cancel_failed", predictionId: prediction.id, error: String(error) }));
  }
}

/** Poll an existing prediction without ever creating a replacement prediction. */
export async function waitForReplicatePrediction(
  env: PipelineEnv,
  initial: ReplicatePredictionRef,
  timeoutMs: number,
): Promise<ReplicatePredictionRef> {
  const deadlineMs = Date.now() + timeoutMs;
  let current = initial;

  while (current.status === "starting" || current.status === "processing") {
    if (Date.now() >= deadlineMs) {
      await cancelPrediction(env, current);
      throw new ReplicateProviderError("Generation timed out", "prediction_timeout", current.id);
    }
    const elapsedMs = timeoutMs - (deadlineMs - Date.now());
    const delay = Math.min(5_000, 1_000 + Math.floor(elapsedMs / 10_000) * 500);
    await new Promise((resolve) => setTimeout(resolve, Math.max(1_000, delay)));
    current = await getReplicatePrediction(env, current.id, deadlineMs);
  }

  if (current.status !== "succeeded") {
    console.error(JSON.stringify({ event: "replicate_prediction_failed", predictionId: current.id, status: current.status }));
    throw new ReplicateProviderError("Generation failed", "prediction_failed", current.id);
  }
  return current;
}

function outputUrlFromValue(value: unknown): string | undefined {
  const parsed = z.union([z.string().url(), z.array(z.string().url()).min(1)]).safeParse(value);
  if (!parsed.success) return undefined;
  return Array.isArray(parsed.data) ? parsed.data[0] : parsed.data;
}

export function isTrustedReplicateDeliveryUrl(url: URL): boolean {
  return url.protocol === "https:"
    && !url.port
    && !url.username
    && !url.password
    && !url.hash
    && (url.hostname === "replicate.delivery" || url.hostname.endsWith(".replicate.delivery"));
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

/**
 * Fetch a Replicate delivery asset without forwarding the API token. Redirects
 * are followed manually so every hop is restricted to replicate.delivery.
 */
export async function fetchReplicateDelivery(outputUrl: string, timeoutMs: number): Promise<Response> {
  let url = new URL(outputUrl);
  for (let redirect = 0; redirect <= MAX_DELIVERY_REDIRECTS; redirect++) {
    if (!isTrustedReplicateDeliveryUrl(url)) {
      throw new ReplicateProviderError("Provider returned an untrusted output URL", "invalid_response");
    }
    const response = await fetchWithDeadline(url, { method: "GET", redirect: "manual" }, timeoutMs);
    if (!isRedirectStatus(response.status)) {
      const finalUrl = new URL(response.url || url.toString());
      if (!isTrustedReplicateDeliveryUrl(finalUrl)) {
        await response.body?.cancel("untrusted delivery response URL");
        throw new ReplicateProviderError("Provider redirected to an untrusted output URL", "invalid_response");
      }
      return response;
    }
    await response.body?.cancel("following validated redirect");
    const location = response.headers.get("location");
    if (!location || redirect === MAX_DELIVERY_REDIRECTS) {
      throw new ReplicateProviderError("Provider returned an invalid delivery redirect", "invalid_response");
    }
    url = new URL(location, url);
  }
  throw new ReplicateProviderError("Provider returned too many delivery redirects", "invalid_response");
}

/** Create one paid Flux prediction. Keep this in its own zero-retry Workflow step. */
export async function createFluxPrediction(
  env: PipelineEnv,
  params: { prompt: string; aspectRatio?: "9:16" | "1:1" | "16:9"; cancelAfterSeconds?: number },
): Promise<ReplicatePredictionRef> {
  return createReplicatePrediction(env, {
    model: "black-forest-labs/flux-schnell",
    cancelAfterSeconds: params.cancelAfterSeconds,
    input: {
      prompt: params.prompt,
      aspect_ratio: params.aspectRatio ?? "9:16",
      output_format: "webp",
      num_outputs: 1,
    },
  });
}

/** Poll an existing Flux prediction. Retrying this never creates another paid prediction. */
export async function waitForFluxPrediction(
  env: PipelineEnv,
  initial: ReplicatePredictionRef,
  timeoutMs = 90_000,
): Promise<string> {
  const prediction = initial.status === "succeeded"
    ? initial
    : await waitForReplicatePrediction(env, initial, timeoutMs);
  if (prediction.status !== "succeeded") {
    throw new ReplicateProviderError("Image generation failed", "prediction_failed", prediction.id);
  }
  const outputUrl = outputUrlFromValue(prediction.output);
  if (!outputUrl) {
    console.error(JSON.stringify({ event: "replicate_output_invalid", predictionId: prediction.id }));
    throw new ReplicateProviderError("Image provider returned an invalid output", "invalid_response", prediction.id);
  }
  return outputUrl;
}

/** Download a bounded Replicate image. Delivery requests never receive the API token. */
export async function downloadReplicateImage(_env: PipelineEnv, outputUrl: string): Promise<ArrayBuffer> {
  const response = await fetchReplicateDelivery(outputUrl, 30_000);
  if (!response.ok) {
    console.error(JSON.stringify({ event: "replicate_output_download_failed", status: response.status }));
    throw new ReplicateProviderError("Generated image could not be downloaded", "provider_unavailable");
  }
  const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (!contentType || !["image/webp", "image/png", "image/jpeg"].includes(contentType)) {
    await response.body?.cancel("unexpected image content type");
    throw new ReplicateProviderError("Image provider returned an unexpected file type", "invalid_response");
  }
  const contentLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_IMAGE_BYTES) {
    await response.body?.cancel("image exceeded size limit");
    throw new ReplicateProviderError("Generated image exceeded the size limit", "invalid_response");
  }
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new ReplicateProviderError("Generated image had an invalid size", "invalid_response");
  }
  return bytes;
}

/** Convenience wrapper for non-Workflow callers. */
export async function replicateGenerateImage(
  env: PipelineEnv,
  params: { prompt: string; aspectRatio?: "9:16" | "1:1" | "16:9"; timeoutMs?: number },
): Promise<ArrayBuffer> {
  const prediction = await createFluxPrediction(env, params);
  const outputUrl = await waitForFluxPrediction(env, prediction, params.timeoutMs ?? 90_000);
  return downloadReplicateImage(env, outputUrl);
}

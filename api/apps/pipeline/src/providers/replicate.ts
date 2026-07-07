import type { PipelineEnv } from "./openai.js";
import type { WhisperWord } from "./openai.js";

type Prediction = {
  id: string;
  status: "starting" | "processing" | "succeeded" | "failed" | "canceled";
  output?: unknown;
  error?: string | null;
  urls?: { get?: string };
};

async function createPrediction(env: PipelineEnv, model: string, input: Record<string, unknown>): Promise<Prediction> {
  const res = await fetch(`https://api.replicate.com/v1/models/${model}/predictions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.REPLICATE_API_TOKEN}`,
      "Content-Type": "application/json",
      Prefer: "wait=30",
    },
    body: JSON.stringify({ input }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Replicate ${model} prediction create failed (${res.status}): ${body}`);
  }
  return (await res.json()) as Prediction;
}

/** Poll a Replicate prediction until it settles or the deadline passes. */
async function pollPrediction(env: PipelineEnv, prediction: Prediction, deadlineMs: number): Promise<Prediction> {
  let current = prediction;
  const getUrl = current.urls?.get ?? `https://api.replicate.com/v1/predictions/${current.id}`;
  while (current.status === "starting" || current.status === "processing") {
    if (Date.now() > deadlineMs) throw new Error(`Replicate prediction ${current.id} timed out`);
    await new Promise((r) => setTimeout(r, 1500));
    const res = await fetch(getUrl, { headers: { Authorization: `Bearer ${env.REPLICATE_API_TOKEN}` } });
    if (!res.ok) throw new Error(`Replicate poll failed (${res.status})`);
    current = (await res.json()) as Prediction;
  }
  return current;
}

/** flux-schnell text-to-image. Returns the raw image bytes (webp) of the first output. */
export async function replicateGenerateImage(
  env: PipelineEnv,
  params: { prompt: string; aspectRatio?: "9:16" | "1:1" | "16:9"; timeoutMs?: number }
): Promise<ArrayBuffer> {
  const prediction = await createPrediction(env, "black-forest-labs/flux-schnell", {
    prompt: params.prompt,
    aspect_ratio: params.aspectRatio ?? "9:16",
    output_format: "webp",
  });
  const deadline = Date.now() + (params.timeoutMs ?? 60_000);
  const finished = await pollPrediction(env, prediction, deadline);
  if (finished.status !== "succeeded") {
    throw new Error(`Replicate flux-schnell failed: ${finished.error ?? finished.status}`);
  }
  const output = finished.output as string[] | string | undefined;
  const imageUrl = Array.isArray(output) ? output[0] : output;
  if (!imageUrl) throw new Error("Replicate flux-schnell returned no image url");
  const imgRes = await fetch(imageUrl);
  if (!imgRes.ok) throw new Error(`Failed to download generated image (${imgRes.status})`);
  return imgRes.arrayBuffer();
}

/** openai/whisper via Replicate — alternative word-timestamp source. Input is a public audio URL. */
export async function replicateWordTimestamps(
  env: PipelineEnv,
  params: { audioUrl: string; timeoutMs?: number }
): Promise<WhisperWord[]> {
  const prediction = await createPrediction(env, "openai/whisper", {
    audio: params.audioUrl,
    model: "large-v3",
    transcription: "word_timestamps",
    word_timestamps: true,
  });
  const deadline = Date.now() + (params.timeoutMs ?? 120_000);
  const finished = await pollPrediction(env, prediction, deadline);
  if (finished.status !== "succeeded") {
    throw new Error(`Replicate whisper failed: ${finished.error ?? finished.status}`);
  }
  const output = finished.output as { segments?: Array<{ words?: Array<{ word: string; start: number; end: number }> }> };
  const words: WhisperWord[] = [];
  for (const seg of output.segments ?? []) {
    for (const w of seg.words ?? []) {
      words.push({ word: w.word, start: w.start, end: w.end });
    }
  }
  if (words.length === 0) throw new Error("Replicate whisper returned no word timestamps");
  return words;
}

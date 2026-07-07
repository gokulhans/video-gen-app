/**
 * OpenAI calls, all routed through Cloudflare AI Gateway
 * (env.AI_GATEWAY_BASE_URL + "/openai/...").
 */

export type PipelineEnv = {
  AI_GATEWAY_BASE_URL: string;
  OPENAI_API_KEY: string;
  GEMINI_API_KEY: string;
  REPLICATE_API_TOKEN: string;
};

function openaiUrl(env: PipelineEnv, path: string) {
  return `${env.AI_GATEWAY_BASE_URL}/openai${path}`;
}

export async function openaiChatCompletion(
  env: PipelineEnv,
  params: { system?: string; user: string; temperature?: number; maxTokens?: number; jsonMode?: boolean }
): Promise<string> {
  const messages = [
    ...(params.system ? [{ role: "system", content: params.system }] : []),
    { role: "user", content: params.user },
  ];

  const res = await fetch(openaiUrl(env, "/chat/completions"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages,
      temperature: params.temperature ?? 0.7,
      max_tokens: params.maxTokens ?? 1500,
      ...(params.jsonMode ? { response_format: { type: "json_object" } } : {}),
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OpenAI chat completion failed (${res.status}): ${body}`);
  }
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenAI chat completion returned no content");
  return content;
}

/** OpenAI TTS. voice is a plain OpenAI voice id (alloy, verse, etc). Returns raw MP3 bytes. */
export async function openaiTextToSpeech(
  env: PipelineEnv,
  params: { text: string; voice: string; model?: string }
): Promise<ArrayBuffer> {
  const res = await fetch(openaiUrl(env, "/audio/speech"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: params.model ?? "gpt-4o-mini-tts",
      input: params.text,
      voice: params.voice,
      response_format: "mp3",
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OpenAI TTS failed (${res.status}): ${body}`);
  }
  return res.arrayBuffer();
}

export type WhisperWord = { word: string; start: number; end: number };

/** Whisper word-level transcription via OpenAI's /audio/transcriptions (verbose_json + word granularity). */
export async function openaiWordTimestamps(
  env: PipelineEnv,
  audio: ArrayBuffer
): Promise<WhisperWord[]> {
  const form = new FormData();
  form.append("file", new Blob([audio], { type: "audio/mpeg" }), "voiceover.mp3");
  form.append("model", "whisper-1");
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "word");

  const res = await fetch(openaiUrl(env, "/audio/transcriptions"), {
    method: "POST",
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: form,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OpenAI Whisper transcription failed (${res.status}): ${body}`);
  }
  const data = (await res.json()) as { words?: WhisperWord[] };
  if (!data.words) throw new Error("OpenAI Whisper response missing word timestamps");
  return data.words;
}

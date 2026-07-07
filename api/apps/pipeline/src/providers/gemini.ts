import type { PipelineEnv } from "./openai.js";

/** Gemini calls routed through Cloudflare AI Gateway (google-ai-studio provider). */
function geminiUrl(env: PipelineEnv, model: string, method: string) {
  return `${env.AI_GATEWAY_BASE_URL}/google-ai-studio/v1beta/models/${model}:${method}`;
}

/** Fallback script generator used when OpenAI is unavailable. */
export async function geminiGenerateText(
  env: PipelineEnv,
  params: { system?: string; user: string; temperature?: number }
): Promise<string> {
  const res = await fetch(geminiUrl(env, "gemini-2.0-flash", "generateContent"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": env.GEMINI_API_KEY,
    },
    body: JSON.stringify({
      ...(params.system ? { systemInstruction: { parts: [{ text: params.system }] } } : {}),
      contents: [{ role: "user", parts: [{ text: params.user }] }],
      generationConfig: { temperature: params.temperature ?? 0.7 },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Gemini generateContent failed (${res.status}): ${body}`);
  }
  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("");
  if (!text) throw new Error("Gemini generateContent returned no text");
  return text;
}

/**
 * Gemini TTS (gemini-2.5-flash-preview-tts). Returns raw 16-bit PCM (24kHz mono) wrapped
 * in a WAV container — Workers has no ffmpeg/mp3 encoder available, so when a `voice`
 * param is prefixed "gemini:" the resulting file is WAV bytes even though it is stored
 * under a `.mp3` key per the composition contract. See README TODO.
 */
export async function geminiTextToSpeech(
  env: PipelineEnv,
  params: { text: string; voiceName: string }
): Promise<ArrayBuffer> {
  const res = await fetch(geminiUrl(env, "gemini-2.5-flash-preview-tts", "generateContent"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": env.GEMINI_API_KEY,
    },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: params.text }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: params.voiceName || "Kore" } },
        },
      },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Gemini TTS failed (${res.status}): ${body}`);
  }
  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }> } }>;
  };
  const b64 = data.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!b64) throw new Error("Gemini TTS returned no audio data");
  const pcm = base64ToArrayBuffer(b64);
  return pcmToWav(pcm, 24000, 1, 16);
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/** Wrap raw PCM samples in a minimal WAV (RIFF) header. */
function pcmToWav(pcm: ArrayBuffer, sampleRate: number, channels: number, bitsPerSample: number): ArrayBuffer {
  const blockAlign = (channels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataSize = pcm.byteLength;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);
  new Uint8Array(buffer, 44).set(new Uint8Array(pcm));
  return buffer;
}

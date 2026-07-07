import { Hono } from "hono";
import type { AppEnv } from "../env";
import { okJson } from "../lib/response";

/**
 * Static voice catalog. Sample MP3s live in ASSETS_BUCKET under voices/<id>.mp3
 * (generated offline — see the old repo's generate-voice-samples scripts) and
 * are served via the assets download-url flow or a public bucket domain.
 * Voice ids prefixed "gemini:" are synthesized by Gemini TTS in the pipeline;
 * all others use OpenAI TTS.
 */
const VOICES = [
	{ id: "alloy", name: "Alloy", provider: "openai", gender: "neutral", languages: ["en", "hi"] },
	{ id: "echo", name: "Echo", provider: "openai", gender: "male", languages: ["en", "hi"] },
	{ id: "fable", name: "Fable", provider: "openai", gender: "male", languages: ["en"] },
	{ id: "onyx", name: "Onyx", provider: "openai", gender: "male", languages: ["en", "hi"] },
	{ id: "nova", name: "Nova", provider: "openai", gender: "female", languages: ["en", "hi"] },
	{ id: "shimmer", name: "Shimmer", provider: "openai", gender: "female", languages: ["en"] },
	{ id: "gemini:Kore", name: "Kore", provider: "gemini", gender: "female", languages: ["en", "hi", "ta", "te", "ml", "kn"] },
	{ id: "gemini:Puck", name: "Puck", provider: "gemini", gender: "male", languages: ["en", "hi", "ta", "te", "ml", "kn"] },
	{ id: "gemini:Charon", name: "Charon", provider: "gemini", gender: "male", languages: ["en", "hi", "ta", "te", "ml", "kn"] },
	{ id: "gemini:Aoede", name: "Aoede", provider: "gemini", gender: "female", languages: ["en", "hi", "ta", "te", "ml", "kn"] },
].map((v) => ({ ...v, sampleKey: `voices/${v.id.replace(":", "_")}.mp3` }));

export const voices = new Hono<AppEnv>();

voices.get("/", (c) => okJson(c, VOICES));

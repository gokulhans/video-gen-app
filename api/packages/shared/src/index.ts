import { z } from "zod";

// ---------- Project composition (the editing document) ----------

export const WordTimestamp = z.object({
	word: z.string(),
	start: z.number(), // seconds
	end: z.number(),
});
export type WordTimestamp = z.infer<typeof WordTimestamp>;

export const SceneEffect = z.object({
	type: z.enum(["zoom_in", "zoom_out", "pan_left", "pan_right", "none"]).default("none"),
	intensity: z.number().min(0).max(1).default(0.5),
});

export const Scene = z.object({
	id: z.string(),
	order: z.number().int(),
	text: z.string(),
	start: z.number(), // seconds
	end: z.number(),
	imagePrompt: z.string().default(""),
	imageUrl: z.string().nullable().default(null),
	imageStatus: z.enum(["pending", "generating", "ready", "failed"]).default("pending"),
	effect: SceneEffect.default({ type: "none", intensity: 0.5 }),
	transition: z.enum(["none", "fade", "slide", "wipe"]).default("fade"),
});
export type Scene = z.infer<typeof Scene>;

export const CaptionConfig = z.object({
	enabled: z.boolean().default(true),
	preset: z.enum(["tiktok", "clean", "bold", "karaoke"]).default("tiktok"),
	position: z.enum(["top", "center", "bottom"]).default("bottom"),
	primaryColor: z.string().default("#FFFFFF"),
	highlightColor: z.string().default("#FFD700"),
	fontSize: z.number().default(48),
});
export type CaptionConfig = z.infer<typeof CaptionConfig>;

export const BrandConfig = z.object({
	logoUrl: z.string().nullable().default(null),
	logoPosition: z.enum(["top_left", "top_right", "bottom_left", "bottom_right", "none"]).default("top_right"),
	primaryColor: z.string().nullable().default(null),
	phone: z.string().nullable().default(null),
	website: z.string().nullable().default(null),
	watermark: z.boolean().default(true),
});

export const ProjectComposition = z.object({
	schemaVersion: z.literal(1).default(1),
	ratio: z.enum(["9:16", "1:1", "16:9"]).default("9:16"),
	durationSec: z.number(),
	language: z.string().default("en"),
	script: z.string(),
	voice: z.string(),
	voiceoverUrl: z.string().nullable().default(null),
	musicUrl: z.string().nullable().default(null),
	musicVolume: z.number().min(0).max(1).default(0.15),
	scenes: z.array(Scene),
	words: z.array(WordTimestamp).default([]),
	captions: CaptionConfig.default({
		enabled: true,
		preset: "tiktok",
		position: "bottom",
		primaryColor: "#FFFFFF",
		highlightColor: "#FFD700",
		fontSize: 48,
	}),
	brand: BrandConfig.default({
		logoUrl: null,
		logoPosition: "top_right",
		primaryColor: null,
		phone: null,
		website: null,
		watermark: true,
	}),
});
export type ProjectComposition = z.infer<typeof ProjectComposition>;

// ---------- Generation ----------

export const GenerationParams = z.object({
	projectId: z.string(),
	userId: z.string(),
	templateId: z.string(),
	brandId: z.string().nullable().default(null),
	topic: z.string().min(3),
	details: z.string().default(""),
	language: z.string().default("en"),
	durationSec: z.number().int().min(15).max(90).default(45),
	voice: z.string().default("alloy"),
});
export type GenerationParams = z.infer<typeof GenerationParams>;

// ---------- Rendering ----------

export const RenderQueueMessage = z.object({
	jobId: z.string(),
	projectId: z.string(),
	userId: z.string(),
	resolution: z.enum(["720p", "1080p"]),
});
export type RenderQueueMessage = z.infer<typeof RenderQueueMessage>;

export const RenderRequest = z.object({
	jobId: z.string(),
	composition: ProjectComposition,
	resolution: z.enum(["720p", "1080p"]),
	outputKey: z.string(), // R2 key in RENDERS_BUCKET
});
export type RenderRequest = z.infer<typeof RenderRequest>;

export const RenderProgressMessage = z.object({
	jobId: z.string(),
	status: z.enum(["queued", "starting", "rendering", "uploading", "completed", "failed"]),
	progress: z.number().min(0).max(100),
	videoUrl: z.string().optional(),
	error: z.string().optional(),
});
export type RenderProgressMessage = z.infer<typeof RenderProgressMessage>;

// ---------- Tokens ----------

export const TOKEN_ACTIONS = [
	"script_generation",
	"voice_generation",
	"image_generation", // per image
	"render_720p",
	"render_1080p",
	"script_rewrite",
] as const;
export type TokenAction = (typeof TOKEN_ACTIONS)[number];

// ---------- API envelope ----------

export type ApiOk<T> = { data: T };
export type ApiErr = { error: { code: string; message: string } };

export const ok = <T>(data: T): ApiOk<T> => ({ data });
export const err = (code: string, message: string): ApiErr => ({ error: { code, message } });

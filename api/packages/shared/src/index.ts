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
	topic: z.string().trim().min(3).max(500),
	details: z.string().trim().max(4_000).default(""),
	language: z.string().trim().min(2).max(20).default("en"),
	durationSec: z.number().int().min(15).max(90).default(45),
	voice: z.string().trim().min(1).max(100).default("alloy"),
});
export type GenerationParams = z.infer<typeof GenerationParams>;

// ---------- Versioned template inputs ----------

const ContractId = z.string().trim().min(1).max(128);
const InputKey = z.string().trim().min(1).max(64).regex(/^[a-z][a-z0-9_]*$/);
const InputLabel = z.string().trim().min(1).max(120);
const InputHelpText = z.string().trim().max(500);

export const TemplateInputScalar = z.union([
	z.string().max(10_000),
	z.number().finite(),
	z.boolean(),
	z.null(),
]);
export type TemplateInputScalar = z.infer<typeof TemplateInputScalar>;

export const TemplateInputValue = z.union([
	TemplateInputScalar,
	z.array(z.string().max(1_000)).max(50),
]);
export type TemplateInputValue = z.infer<typeof TemplateInputValue>;

export const TemplateInputValues = z.record(InputKey, TemplateInputValue);
export type TemplateInputValues = z.infer<typeof TemplateInputValues>;

/** Declarative visibility only; clients must never evaluate server-provided code. */
export const TemplateInputVisibilityRule = z.object({
	field: InputKey,
	operator: z.enum(["equals", "not_equals", "in"]),
	value: z.union([TemplateInputScalar, z.array(TemplateInputScalar).max(20)]),
}).strict();

const TemplateInputBase = {
	id: ContractId,
	key: InputKey,
	label: InputLabel,
	helpText: InputHelpText.optional(),
	required: z.boolean().default(false),
	order: z.number().int().min(0).max(10_000).default(0),
	visibility: TemplateInputVisibilityRule.optional(),
};

export const TemplateInputDefinition = z.discriminatedUnion("type", [
	z.object({
		...TemplateInputBase,
		type: z.literal("short_text"),
		placeholder: z.string().max(160).optional(),
		minLength: z.number().int().min(0).max(1_000).optional(),
		maxLength: z.number().int().min(1).max(1_000).default(500),
	}).strict(),
	z.object({
		...TemplateInputBase,
		type: z.literal("long_text"),
		placeholder: z.string().max(160).optional(),
		minLength: z.number().int().min(0).max(10_000).optional(),
		maxLength: z.number().int().min(1).max(10_000).default(4_000),
	}).strict(),
	z.object({
		...TemplateInputBase,
		type: z.literal("number"),
		min: z.number().finite().optional(),
		max: z.number().finite().optional(),
		step: z.number().positive().finite().optional(),
		unit: z.string().trim().max(24).optional(),
	}).strict(),
	z.object({
		...TemplateInputBase,
		type: z.literal("boolean"),
		defaultValue: z.boolean().optional(),
	}).strict(),
	z.object({
		...TemplateInputBase,
		type: z.literal("select"),
		multiple: z.boolean().default(false),
		options: z.array(z.object({
			value: z.union([
				z.string().trim().min(1).max(100),
				z.number().finite(),
				z.boolean(),
			]),
			label: z.string().trim().min(1).max(120),
		}).strict()).min(1).max(100),
	}).strict(),
	z.object({
		...TemplateInputBase,
		type: z.literal("image"),
		maxFiles: z.number().int().min(1).max(20).default(1),
		maxBytes: z.number().int().positive().max(50_000_000),
		acceptedContentTypes: z.array(z.enum(["image/jpeg", "image/png", "image/webp"])).min(1),
	}).strict(),
	z.object({
		...TemplateInputBase,
		type: z.literal("audio"),
		maxBytes: z.number().int().positive().max(100_000_000),
		acceptedContentTypes: z.array(z.enum(["audio/flac", "audio/mpeg", "audio/wav", "audio/x-wav"])).min(1),
	}).strict(),
]);
export type TemplateInputDefinition = z.infer<typeof TemplateInputDefinition>;

export const TemplateInputSchema = z.object({
	version: z.literal(1),
	fields: z.array(TemplateInputDefinition).max(100),
}).strict();
export type TemplateInputSchema = z.infer<typeof TemplateInputSchema>;

// ---------- P-Video adapter boundary ----------

/**
 * Provider-neutral names normalized for the Pruna P-Video adapter. URLs are
 * short-lived, server-created ingestion URLs; clients never submit provider payloads.
 */
export const NormalizedPVideoInput = z.object({
	prompt: z.string().trim().min(1).max(10_000),
	imageUrl: z.string().url().optional(),
	audioUrl: z.string().url().optional(),
	lastFrameImageUrl: z.string().url().optional(),
	durationSec: z.number().int().min(1).max(20).default(1),
	aspectRatio: z.enum(["16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "1:1"]).default("16:9"),
	resolution: z.enum(["720p", "1080p"]).default("720p"),
	fps: z.union([z.literal(24), z.literal(48)]).default(24),
	draft: z.boolean().default(true),
	promptUpsampling: z.boolean().default(true),
	includeGeneratedAudio: z.boolean().default(false),
	seed: z.number().int().min(0).max(2_147_483_647).optional(),
}).strict();
export type NormalizedPVideoInput = z.infer<typeof NormalizedPVideoInput>;

// ---------- Generation job API ----------

export const GENERATION_JOB_STATES = [
	"draft",
	"validating",
	"credit_reserved",
	"queued",
	"submitting",
	"provider_processing",
	"ingesting",
	"post_processing",
	"rendering",
	"publishing",
	"completed",
	"failed",
	"cancelled",
] as const;

export const GenerationJobState = z.enum(GENERATION_JOB_STATES);
export type GenerationJobState = z.infer<typeof GenerationJobState>;

export const GENERATION_JOB_TRANSITIONS: Readonly<Record<GenerationJobState, readonly GenerationJobState[]>> = {
	draft: ["validating", "cancelled"],
	validating: ["credit_reserved", "failed", "cancelled"],
	credit_reserved: ["queued", "failed", "cancelled"],
	queued: ["submitting", "failed", "cancelled"],
	submitting: ["provider_processing", "failed", "cancelled"],
	provider_processing: ["ingesting", "failed", "cancelled"],
	ingesting: ["post_processing", "failed"],
	post_processing: ["rendering", "publishing", "failed"],
	rendering: ["publishing", "failed"],
	publishing: ["completed", "failed"],
	completed: [],
	failed: [],
	cancelled: [],
};

export const isGenerationJobTransitionAllowed = (from: GenerationJobState, to: GenerationJobState): boolean =>
	GENERATION_JOB_TRANSITIONS[from].includes(to);

export const CharacterSelection = z.discriminatedUnion("type", [
	z.object({ type: z.literal("stock"), stockCharacterId: ContractId }).strict(),
	z.object({ type: z.literal("user"), userCharacterVersionId: ContractId }).strict(),
]);
export type CharacterSelection = z.infer<typeof CharacterSelection>;

const GenerationSelection = {
	templateVersionId: ContractId,
	inputs: TemplateInputValues,
	voiceId: ContractId.optional(),
	character: CharacterSelection.optional(),
	brandId: ContractId.optional(),
};

export const QuoteGenerationRequest = z.object(GenerationSelection).strict();
export type QuoteGenerationRequest = z.infer<typeof QuoteGenerationRequest>;

export const GenerationQuote = z.object({
	quoteId: ContractId,
	templateVersionId: ContractId,
	pricingVersionId: ContractId,
	creditAmount: z.number().int().nonnegative(),
	estimatedDurationSec: z.object({ min: z.number().int().nonnegative(), max: z.number().int().nonnegative() }).strict(),
	expiresAt: z.number().int().nonnegative(),
}).strict();
export type GenerationQuote = z.infer<typeof GenerationQuote>;

export const CreateGenerationJobRequest = z.object({
	...GenerationSelection,
	quoteId: ContractId,
	idempotencyKey: z.string().trim().min(8).max(128),
}).strict();
export type CreateGenerationJobRequest = z.infer<typeof CreateGenerationJobRequest>;

export const GenerationJob = z.object({
	id: ContractId,
	templateId: ContractId,
	templateVersionId: ContractId,
	status: GenerationJobState,
	progress: z.number().int().min(0).max(100),
	quotedCredits: z.number().int().nonnegative(),
	previewAssetId: ContractId.nullable().default(null),
	videoAssetId: ContractId.nullable().default(null),
	error: z.object({ code: z.string().max(100), message: z.string().max(1_000) }).strict().nullable().default(null),
	createdAt: z.number().int().nonnegative(),
	updatedAt: z.number().int().nonnegative(),
	completedAt: z.number().int().nonnegative().nullable().default(null),
}).strict();
export type GenerationJob = z.infer<typeof GenerationJob>;

export const CreateGenerationJobResponse = z.object({
	job: GenerationJob,
	replayed: z.boolean(),
}).strict();
export type CreateGenerationJobResponse = z.infer<typeof CreateGenerationJobResponse>;

export const ListGenerationJobsQuery = z.object({
	cursor: z.string().trim().min(1).max(512).optional(),
	limit: z.coerce.number().int().min(1).max(100).default(20),
	status: GenerationJobState.optional(),
	templateId: ContractId.optional(),
}).strict();
export type ListGenerationJobsQuery = z.infer<typeof ListGenerationJobsQuery>;

export const ListGenerationJobsResponse = z.object({
	items: z.array(GenerationJob),
	nextCursor: z.string().max(512).nullable(),
}).strict();
export type ListGenerationJobsResponse = z.infer<typeof ListGenerationJobsResponse>;

// ---------- Normalized provider events (internal only) ----------

export const ProviderExecutionRef = z.object({
	providerId: ContractId,
	providerModelVersionId: ContractId,
	attemptId: ContractId,
	providerJobId: z.string().trim().min(1).max(512),
}).strict();
export type ProviderExecutionRef = z.infer<typeof ProviderExecutionRef>;

export const NormalizedProviderEvent = z.object({
	providerEventId: z.string().trim().min(1).max(512),
	execution: ProviderExecutionRef,
	status: z.enum(["pending", "running", "succeeded", "failed", "cancelled"]),
	progress: z.number().min(0).max(100).optional(),
	outputUrls: z.array(z.string().url()).max(20).default([]),
	error: z.object({
		classification: z.enum(["retryable", "non_retryable", "moderation", "quota", "provider_incident"]),
		code: z.string().trim().max(100).optional(),
		message: z.string().trim().max(1_000),
	}).strict().optional(),
	occurredAt: z.number().int().nonnegative(),
}).strict();
export type NormalizedProviderEvent = z.infer<typeof NormalizedProviderEvent>;

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

export const DEFAULT_TOKEN_COSTS: Record<TokenAction, number> = {
	script_generation: 50,
	voice_generation: 100,
	image_generation: 75,
	render_720p: 100,
	render_1080p: 200,
	script_rewrite: 30,
};

// ---------- API envelope ----------

export type ApiOk<T> = { data: T };
export type ApiErr = { error: { code: string; message: string } };

export const ok = <T>(data: T): ApiOk<T> => ({ data });
export const err = (code: string, message: string): ApiErr => ({ error: { code, message } });

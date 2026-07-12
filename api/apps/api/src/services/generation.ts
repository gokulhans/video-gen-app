import { and, desc, eq, inArray, lt, or } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@app/db";
import {
	GenerationJob as GenerationJobContract,
	GenerationQuote,
	ListGenerationJobsQuery,
	NormalizedPVideoInput,
	QuoteGenerationRequest,
	type CreateGenerationJobRequest,
	type GenerationJob,
	type GenerationJobState,
	type QuoteGenerationRequest as QuoteRequest,
} from "@app/shared";
import type { Env } from "../env";
import { ensureUploadReady, loadUploadByFetchToken, type UploadKind } from "../lib/media";

const QUOTE_TTL_SECONDS = 10 * 60;
const RESERVATION_TTL_MS = 30 * 60_000;

const PublishedConfig = z.object({
	provider: z.literal("replicate"),
	model: z.literal("prunaai/p-video"),
	modelVersion: z.string().min(1),
	mode: z.enum(["test", "production"]).default("production"),
	defaults: NormalizedPVideoInput.partial().default({}),
}).passthrough();

const JobConfigurationSnapshot = z.object({
	schemaVersion: z.literal(1),
	pipelineType: z.literal("p_video"),
	template: z.object({ id: z.string(), version: z.number().int().positive() }).strict(),
	pricing: z.object({ id: z.string() }).strict(),
	provider: z.object({ id: z.string(), key: z.literal("replicate") }).strict(),
	model: z.object({
		id: z.string(), key: z.literal("prunaai/p-video"), versionId: z.string(), versionRef: z.string(),
	}).strict(),
	testMode: z.boolean(),
	inputMapping: z.record(z.string(), z.string()),
}).strict();

const StoredQuote = z.object({
	quote: GenerationQuote,
	userId: z.string(),
	request: QuoteGenerationRequest,
	normalizedInputs: NormalizedPVideoInput,
	configurationSnapshot: JobConfigurationSnapshot,
	templateId: z.string(),
	estimatedCostMicros: z.number().int().nonnegative(),
}).strict();

type StoredQuote = z.infer<typeof StoredQuote>;
type GenerationRow = typeof schema.generationJobs.$inferSelect;

export class GenerationServiceError extends Error {
	constructor(
		public readonly code: "not_found" | "validation_error" | "conflict" | "insufficient_tokens" | "workflow_start_failed",
		message: string,
	) {
		super(message);
	}
}

function parseJsonObject(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function optionValues(value: unknown): unknown[] {
	if (!Array.isArray(value)) return [];
	return value.map((option) => option && typeof option === "object" && "value" in option ? (option as { value: unknown }).value : option);
}

async function validateInputs(env: Env, userId: string, versionId: string, raw: QuoteRequest["inputs"]) {
	const db = getDb(env.DB);
	const definitions = await db.select().from(schema.templateInputDefinitions)
		.where(eq(schema.templateInputDefinitions.templateVersionId, versionId));
	const known = new Map(definitions.map((definition) => [definition.fieldKey, definition]));
	for (const key of Object.keys(raw)) {
		if (!known.has(key)) throw new GenerationServiceError("validation_error", `Unknown template input: ${key}`);
	}
	for (const definition of definitions) {
		const value = raw[definition.fieldKey];
		if (definition.isRequired && (value === undefined || value === null || value === "")) {
			throw new GenerationServiceError("validation_error", `${definition.label} is required`);
		}
		if (value === undefined || value === null) continue;
		const constraints = parseJsonObject(definition.constraints);
		if (definition.fieldType === "short_text" || definition.fieldType === "long_text") {
			if (typeof value !== "string") throw new GenerationServiceError("validation_error", `${definition.label} must be text`);
			if (typeof constraints.minLength === "number" && value.length < constraints.minLength) throw new GenerationServiceError("validation_error", `${definition.label} is too short`);
			if (typeof constraints.maxLength === "number" && value.length > constraints.maxLength) throw new GenerationServiceError("validation_error", `${definition.label} is too long`);
		}
		if (definition.fieldType === "select" && !optionValues(definition.options).includes(value)) {
			throw new GenerationServiceError("validation_error", `${definition.label} has an unsupported value`);
		}
		if (definition.fieldType === "image" || definition.fieldType === "audio") {
			if (typeof value !== "string") {
				throw new GenerationServiceError("validation_error", `${definition.label} must be an uploaded asset`);
			}
			await validateOwnedAsset(env, userId, value, definition.label, definition.fieldType);
		}
	}
}

async function validateOwnedAsset(env: Env, userId: string, urlValue: string, label: string, expectedKind: UploadKind) {
	let url: URL;
	try { url = new URL(urlValue); } catch { throw new GenerationServiceError("validation_error", `${label} must be a valid asset URL`); }
	const base = new URL(env.APP_BASE_URL);
	const match = /^\/media\/input\/([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(url.pathname);
	if (url.protocol !== "https:" || url.origin !== base.origin || url.search || url.hash || !match) {
		throw new GenerationServiceError("validation_error", `${label} must use a registered application upload`);
	}
	const record = await loadUploadByFetchToken(env, match[1]);
	if (!record || record.userId !== userId || record.kind !== expectedKind) {
		throw new GenerationServiceError("validation_error", `${label} was not found`);
	}
	try { await ensureUploadReady(env, record); }
	catch { throw new GenerationServiceError("validation_error", `${label} upload is incomplete or invalid`); }
}

async function validateTenantSelections(env: Env, userId: string, request: QuoteRequest) {
	const db = getDb(env.DB);
	if (request.brandId) {
		const row = await db.select({ id: schema.brands.id }).from(schema.brands)
			.where(and(eq(schema.brands.id, request.brandId), eq(schema.brands.userId, userId))).get();
		if (!row) throw new GenerationServiceError("not_found", "Brand not found");
	}
	if (request.voiceId) {
		const row = await db.select({ id: schema.voices.id }).from(schema.voices)
			.where(and(eq(schema.voices.id, request.voiceId), eq(schema.voices.isActive, true))).get();
		if (!row) throw new GenerationServiceError("not_found", "Voice not found");
	}
	if (request.character?.type === "stock") {
		const now = Date.now();
		const row = await db.select().from(schema.stockCharacters)
			.where(and(eq(schema.stockCharacters.id, request.character.stockCharacterId), eq(schema.stockCharacters.isActive, true))).get();
		if (!row || row.consentStatus !== "verified" || (row.licenseExpiresAt !== null && row.licenseExpiresAt <= now)) {
			throw new GenerationServiceError("not_found", "Character not found");
		}
	}
	if (request.character?.type === "user") {
		const row = await db.select({ id: schema.userCharacterVersions.id }).from(schema.userCharacterVersions)
			.where(and(
				eq(schema.userCharacterVersions.id, request.character.userCharacterVersionId),
				eq(schema.userCharacterVersions.userId, userId),
				eq(schema.userCharacterVersions.status, "ready"),
			)).get();
		if (!row) throw new GenerationServiceError("not_found", "Character not found");
	}
}

async function resolvePublishedSelection(env: Env, versionId: string) {
	const db = getDb(env.DB);
	const row = await db.select({
		templateId: schema.templates.id,
		templateVersionId: schema.templateVersions.id,
		templateVersion: schema.templateVersions.version,
		pipelineType: schema.templateVersions.pipelineType,
		pricingVersionId: schema.pricingVersions.id,
		creditAmount: schema.pricingVersions.creditAmount,
		estimatedCostMicros: schema.pricingVersions.estimatedCostMicros,
		configSnapshot: schema.templateVersions.configSnapshot,
		providerId: schema.providers.id,
		providerKey: schema.providers.providerKey,
		modelId: schema.providerModels.id,
		modelKey: schema.providerModels.modelKey,
		modelVersionId: schema.providerModelVersions.id,
		modelVersionRef: schema.providerModelVersions.providerVersionRef,
		inputMapping: schema.templatePipelineBindings.inputMapping,
	}).from(schema.templateVersions)
		.innerJoin(schema.templates, eq(schema.templates.currentVersionId, schema.templateVersions.id))
		.innerJoin(schema.pricingVersions, eq(schema.templateVersions.pricingVersionId, schema.pricingVersions.id))
		.innerJoin(schema.templatePipelineBindings, eq(schema.templatePipelineBindings.templateVersionId, schema.templateVersions.id))
		.innerJoin(schema.providerModelVersions, eq(schema.templatePipelineBindings.providerModelVersionId, schema.providerModelVersions.id))
		.innerJoin(schema.providerModels, eq(schema.providerModelVersions.providerModelId, schema.providerModels.id))
		.innerJoin(schema.providers, eq(schema.providerModels.providerId, schema.providers.id))
		.where(and(
			eq(schema.templateVersions.id, versionId), eq(schema.templateVersions.status, "published"),
			eq(schema.templates.isActive, true), eq(schema.templates.lifecycleStatus, "active"),
			eq(schema.pricingVersions.status, "published"), eq(schema.templatePipelineBindings.isActive, true),
			eq(schema.providerModelVersions.status, "published"), eq(schema.providerModels.isActive, true),
			eq(schema.providers.isActive, true),
		))
		.orderBy(schema.templatePipelineBindings.priority)
		.get();
	if (!row || row.pipelineType !== "p_video") throw new GenerationServiceError("not_found", "Published template version not found");
	const published = PublishedConfig.safeParse(row.configSnapshot);
	if (!published.success || published.data.provider !== row.providerKey || published.data.model !== row.modelKey || published.data.modelVersion !== row.modelVersionRef) {
		throw new GenerationServiceError("conflict", "Published template configuration is invalid");
	}
	return { row, published: published.data };
}

export async function createGenerationQuote(env: Env, userId: string, input: unknown) {
	const requestResult = QuoteGenerationRequest.safeParse(input);
	if (!requestResult.success) throw new GenerationServiceError("validation_error", requestResult.error.issues[0]?.message ?? "Invalid quote request");
	const request = requestResult.data;
	const { row, published } = await resolvePublishedSelection(env, request.templateVersionId);
	await Promise.all([
		validateInputs(env, userId, request.templateVersionId, request.inputs),
		validateTenantSelections(env, userId, request),
	]);
	const normalizedResult = NormalizedPVideoInput.safeParse({ ...published.defaults, ...request.inputs });
	if (!normalizedResult.success) throw new GenerationServiceError("validation_error", normalizedResult.error.issues[0]?.message ?? "Invalid generation inputs");
	if (published.mode === "test") {
		const value = normalizedResult.data;
		const safeTestPreset = value.durationSec === 1
			&& value.resolution === "720p"
			&& value.fps === 24
			&& value.draft === true
			&& value.promptUpsampling === true
			&& value.includeGeneratedAudio === false
			&& value.audioUrl === undefined;
		if (!safeTestPreset) {
			throw new GenerationServiceError(
				"validation_error",
				"Test mode is locked to one second, 720p, 24 fps, draft output, prompt upsampling, and no audio input or generated audio",
			);
		}
	}
	const configurationSnapshot = JobConfigurationSnapshot.parse({
		schemaVersion: 1,
		pipelineType: "p_video",
		template: { id: row.templateVersionId, version: row.templateVersion },
		pricing: { id: row.pricingVersionId },
		provider: { id: row.providerId, key: row.providerKey },
		model: { id: row.modelId, key: row.modelKey, versionId: row.modelVersionId, versionRef: row.modelVersionRef },
		testMode: published.mode === "test",
		inputMapping: parseJsonObject(row.inputMapping),
	});
	const now = Date.now();
	const quote = GenerationQuote.parse({
		quoteId: crypto.randomUUID(), templateVersionId: row.templateVersionId, pricingVersionId: row.pricingVersionId,
		creditAmount: row.creditAmount, estimatedDurationSec: { min: 15, max: configurationSnapshot.testMode ? 180 : 600 },
		expiresAt: now + QUOTE_TTL_SECONDS * 1000,
	});
	const stored: StoredQuote = {
		quote, userId, request, normalizedInputs: normalizedResult.data, configurationSnapshot,
		templateId: row.templateId, estimatedCostMicros: row.estimatedCostMicros,
	};
	await getDb(env.DB).insert(schema.generationQuotes).values({
		id: quote.quoteId,
		userId,
		payload: stored,
		expiresAt: quote.expiresAt,
		createdAt: now,
	});
	return quote;
}

async function loadStoredQuote(env: Env, userId: string, quoteId: string): Promise<StoredQuote | null> {
	const row = await getDb(env.DB).select({ payload: schema.generationQuotes.payload })
		.from(schema.generationQuotes)
		.where(and(eq(schema.generationQuotes.id, quoteId), eq(schema.generationQuotes.userId, userId)))
		.get();
	const parsed = StoredQuote.safeParse(row?.payload);
	return parsed.success ? parsed.data : null;
}

function canonicalJson(value: unknown): string {
	const normalize = (input: unknown): unknown => {
		if (Array.isArray(input)) return input.map(normalize);
		if (input && typeof input === "object") {
			return Object.fromEntries(
				Object.entries(input as Record<string, unknown>)
					.sort(([left], [right]) => left.localeCompare(right))
					.map(([key, child]) => [key, normalize(child)]),
			);
		}
		return input;
	};
	return JSON.stringify(normalize(value));
}

function sameSelection(left: QuoteRequest, right: QuoteRequest) {
	return canonicalJson(left) === canonicalJson(right);
}

function jobMatchesQuote(job: GenerationRow, stored: StoredQuote) {
	const stockCharacterId = stored.request.character?.type === "stock" ? stored.request.character.stockCharacterId : null;
	const userCharacterVersionId = stored.request.character?.type === "user" ? stored.request.character.userCharacterVersionId : null;
	return job.templateId === stored.templateId
		&& job.templateVersionId === stored.quote.templateVersionId
		&& job.pricingVersionId === stored.quote.pricingVersionId
		&& job.voiceId === (stored.request.voiceId ?? null)
		&& job.stockCharacterId === stockCharacterId
		&& job.userCharacterVersionId === userCharacterVersionId
		&& canonicalJson(job.normalizedInputs) === canonicalJson(stored.normalizedInputs)
		&& canonicalJson(job.configurationSnapshot) === canonicalJson(stored.configurationSnapshot);
}

function replaySelectionMatchesJob(job: GenerationRow, request: QuoteRequest) {
	const normalized = NormalizedPVideoInput.safeParse(job.normalizedInputs);
	const stockCharacterId = request.character?.type === "stock" ? request.character.stockCharacterId : null;
	const userCharacterVersionId = request.character?.type === "user" ? request.character.userCharacterVersionId : null;
	return normalized.success
		&& job.templateVersionId === request.templateVersionId
		&& job.voiceId === (request.voiceId ?? null)
		&& job.stockCharacterId === stockCharacterId
		&& job.userCharacterVersionId === userCharacterVersionId
		&& Object.entries(request.inputs).every(([key, value]) => canonicalJson(normalized.data[key as keyof typeof normalized.data]) === canonicalJson(value));
}

function publicJob(row: GenerationRow, assetIds: { preview: string | null; video: string | null }): GenerationJob {
	return GenerationJobContract.parse({
		id: row.id, templateId: row.templateId, templateVersionId: row.templateVersionId,
		status: row.status, progress: row.progress, quotedCredits: row.quotedCredits,
		previewAssetId: assetIds.preview, videoAssetId: assetIds.video,
		error: row.errorCode ? { code: row.errorCode, message: row.errorMessage ?? "Generation failed" } : null,
		createdAt: row.createdAt, updatedAt: row.updatedAt, completedAt: row.completedAt,
	});
}

async function assetsForJobs(env: Env, jobIds: string[]) {
	const result = new Map<string, { preview: string | null; video: string | null }>();
	for (const id of jobIds) result.set(id, { preview: null, video: null });
	if (jobIds.length === 0) return result;
	const rows = await getDb(env.DB).select().from(schema.generationAssets)
		.where(and(inArray(schema.generationAssets.jobId, jobIds), eq(schema.generationAssets.status, "ready")))
		.orderBy(desc(schema.generationAssets.createdAt));
	for (const asset of rows) {
		const current = result.get(asset.jobId);
		if (!current) continue;
		if (asset.kind === "preview" && !current.preview) current.preview = asset.id;
		if (asset.kind === "playback") current.video = asset.id;
		else if ((asset.kind === "video" || asset.kind === "output_video" || asset.kind === "video_master") && !current.video) current.video = asset.id;
	}
	return result;
}

async function compensateWorkflowStart(env: Env, job: GenerationRow) {
	const now = Date.now();
	const refundId = crypto.randomUUID();
	const operationKey = `generation:${job.id}:workflow-start-refund`;
	await env.DB.batch([
		env.DB.prepare(`INSERT OR IGNORE INTO token_transactions (id,user_id,amount,type,description,operation_key,created_at)
			SELECT ?,r.user_id,r.amount,'generation_refund',?, ?, ? FROM credit_reservations r
			JOIN generation_jobs j ON j.id=r.job_id WHERE r.job_id=? AND r.status='reserved' AND j.status='queued'`)
			.bind(refundId, `Refund: generation ${job.id} could not start`, operationKey, now, job.id),
		env.DB.prepare(`UPDATE user SET tokens=tokens+?, updated_at=? WHERE id=? AND EXISTS
			(SELECT 1 FROM credit_reservations r JOIN generation_jobs j ON j.id=r.job_id
			 WHERE r.job_id=? AND r.status='reserved' AND j.status='queued')`).bind(job.quotedCredits, now, job.userId, job.id),
		env.DB.prepare(`UPDATE credit_reservations SET status='released',settlement_transaction_id=?,settled_at=?,updated_at=?
			WHERE job_id=? AND status='reserved' AND EXISTS
			(SELECT 1 FROM generation_jobs WHERE id=? AND status='queued')`)
			.bind(refundId, now, now, job.id, job.id),
		env.DB.prepare("UPDATE generation_jobs SET status='failed',error_code='workflow_start_failed',error_message='Generation could not be queued',updated_at=?,completed_at=? WHERE id=? AND status='queued'")
			.bind(now, now, job.id),
		env.DB.prepare(`INSERT OR IGNORE INTO generation_job_events
			(id,job_id,operation_key,source,event_type,from_status,to_status,payload,created_at) VALUES (?,?,?,?,?,?,?,?,?)`)
			.bind(crypto.randomUUID(), job.id, `workflow-start-failed:${job.id}`, "api", "workflow_start_failed", "queued", "failed", JSON.stringify({ requestId: job.requestId }), now),
	]);
}

async function startWorkflow(env: Env, job: GenerationRow) {
	if (job.status !== "queued" || !job.workflowInstanceId) return;
	try {
		await env.P_VIDEO_GENERATION.create({ id: job.workflowInstanceId, params: { jobId: job.id, userId: job.userId } });
	} catch (error) {
		const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
		if (message.includes("already") || message.includes("exist")) return;
		try {
			const existing = await env.P_VIDEO_GENERATION.get(job.workflowInstanceId);
			await existing.status();
			return;
		} catch {
			await compensateWorkflowStart(env, job);
			throw new GenerationServiceError("workflow_start_failed", "Generation could not be queued; reserved credits were released");
		}
	}
}

export async function createGenerationJob(env: Env, userId: string, requestId: string, body: unknown, idempotencyKey: string) {
	if (!/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) throw new GenerationServiceError("validation_error", "A valid Idempotency-Key header is required");
	const parsed = z.object({
		templateVersionId: z.string(), inputs: z.record(z.string(), z.unknown()), quoteId: z.string(),
		voiceId: z.string().optional(), character: z.union([
			z.object({ type: z.literal("stock"), stockCharacterId: z.string() }),
			z.object({ type: z.literal("user"), userCharacterVersionId: z.string() }),
		]).optional(), brandId: z.string().optional(), idempotencyKey: z.string().optional(),
	}).strict().safeParse(body);
	if (!parsed.success) throw new GenerationServiceError("validation_error", parsed.error.issues[0]?.message ?? "Invalid generation request");
	if (parsed.data.idempotencyKey && parsed.data.idempotencyKey !== idempotencyKey) throw new GenerationServiceError("conflict", "Idempotency key header and body do not match");
	const selectionResult = QuoteGenerationRequest.safeParse({
		templateVersionId: parsed.data.templateVersionId,
		inputs: parsed.data.inputs,
		voiceId: parsed.data.voiceId,
		character: parsed.data.character,
		brandId: parsed.data.brandId,
	});
	if (!selectionResult.success) throw new GenerationServiceError("validation_error", selectionResult.error.issues[0]?.message ?? "Invalid generation request");

	const existing = await getDb(env.DB).select().from(schema.generationJobs)
		.where(and(eq(schema.generationJobs.userId, userId), eq(schema.generationJobs.idempotencyKey, idempotencyKey))).get();
	if (existing) {
		const storedInputs = NormalizedPVideoInput.safeParse(existing.normalizedInputs);
		const storedQuote = await loadStoredQuote(env, userId, parsed.data.quoteId);
		if (!replaySelectionMatchesJob(existing, selectionResult.data)) {
			throw new GenerationServiceError("conflict", "Idempotency key was already used for a different request");
		}
		if (storedQuote && (!sameSelection(storedQuote.request, selectionResult.data) || !jobMatchesQuote(existing, storedQuote)
			|| (storedInputs.success && canonicalJson(storedInputs.data) !== canonicalJson(storedQuote.normalizedInputs)))) {
			throw new GenerationServiceError("conflict", "Idempotency key was already used for a different request");
		}
		await startWorkflow(env, existing);
		const assets = await assetsForJobs(env, [existing.id]);
		return { job: publicJob(existing, assets.get(existing.id)!), replayed: true };
	}

	const storedQuote = await loadStoredQuote(env, userId, parsed.data.quoteId);
	if (!storedQuote || storedQuote.userId !== userId || storedQuote.quote.expiresAt <= Date.now()) {
		throw new GenerationServiceError("validation_error", "Quote is invalid or expired");
	}
	const stored = storedQuote;
	if (!sameSelection(stored.request, selectionResult.data)) throw new GenerationServiceError("conflict", "Request does not match the server quote");
	const jobId = crypto.randomUUID();
	const workflowInstanceId = `pvideo-${jobId}`;
	const reservationId = crypto.randomUUID();
	const transactionId = crypto.randomUUID();
	const now = Date.now();
	const stockCharacterId = stored.request.character?.type === "stock" ? stored.request.character.stockCharacterId : null;
	const userCharacterVersionId = stored.request.character?.type === "user" ? stored.request.character.userCharacterVersionId : null;
	try {
		await env.DB.batch([
			env.DB.prepare(`INSERT INTO generation_jobs
				(id,user_id,template_id,template_version_id,pricing_version_id,voice_id,stock_character_id,user_character_version_id,idempotency_key,request_id,workflow_instance_id,status,progress,normalized_inputs,configuration_snapshot,quoted_credits,estimated_cost_micros,actual_cost_micros,created_at,updated_at)
				SELECT ?,?,?,?,?,?,?,?,?,?,?, 'queued',0,?,?,?,?,0,?,? FROM user WHERE id=? AND tokens>=?`)
				.bind(jobId, userId, stored.templateId, stored.quote.templateVersionId, stored.quote.pricingVersionId, stored.request.voiceId ?? null,
					stockCharacterId, userCharacterVersionId, idempotencyKey, requestId, workflowInstanceId,
					JSON.stringify(stored.normalizedInputs), JSON.stringify(stored.configurationSnapshot), stored.quote.creditAmount,
					stored.estimatedCostMicros, now, now, userId, stored.quote.creditAmount),
			env.DB.prepare(`INSERT INTO credit_reservations
				(id,user_id,job_id,operation_key,amount,status,reserve_transaction_id,expires_at,created_at,updated_at)
				VALUES (?,?,?,?,?,'reserved',?,?,?,?)`)
				.bind(reservationId, userId, jobId, `generation:${jobId}:reserve`, stored.quote.creditAmount, transactionId, now + RESERVATION_TTL_MS, now, now),
			env.DB.prepare("UPDATE user SET tokens=tokens-?,updated_at=? WHERE id=? AND tokens>=?")
				.bind(stored.quote.creditAmount, now, userId, stored.quote.creditAmount),
			env.DB.prepare(`INSERT INTO token_transactions (id,user_id,amount,type,description,operation_key,created_at)
				VALUES (?,?,?,'generation_reserve',?,?,?)`)
				.bind(transactionId, userId, -stored.quote.creditAmount, `Reserve credits for generation ${jobId}`, `generation:${jobId}:reserve-debit`, now),
			env.DB.prepare(`INSERT INTO generation_job_events
				(id,job_id,operation_key,source,event_type,from_status,to_status,payload,created_at) VALUES (?,?,?,?,?,?,?,?,?)`)
				.bind(crypto.randomUUID(), jobId, `created:${jobId}`, "api", "job_created", "draft", "credit_reserved", JSON.stringify({ requestId, quoteId: stored.quote.quoteId }), now),
			env.DB.prepare(`INSERT INTO generation_job_events
				(id,job_id,operation_key,source,event_type,from_status,to_status,payload,created_at) VALUES (?,?,?,?,?,?,?,?,?)`)
				.bind(crypto.randomUUID(), jobId, `queued:${jobId}`, "api", "state_transition", "credit_reserved", "queued", JSON.stringify({ requestId }), now),
		]);
	} catch (error) {
		const raced = await getDb(env.DB).select().from(schema.generationJobs)
			.where(and(eq(schema.generationJobs.userId, userId), eq(schema.generationJobs.idempotencyKey, idempotencyKey))).get();
		if (raced) {
			if (!jobMatchesQuote(raced, stored)) throw new GenerationServiceError("conflict", "Idempotency key was already used for a different request");
			await startWorkflow(env, raced);
			const assets = await assetsForJobs(env, [raced.id]);
			return { job: publicJob(raced, assets.get(raced.id)!), replayed: true };
		}
		const account = await getDb(env.DB).select({ tokens: schema.user.tokens }).from(schema.user).where(eq(schema.user.id, userId)).get();
		if (account && account.tokens < stored.quote.creditAmount) throw new GenerationServiceError("insufficient_tokens", "Insufficient token balance");
		throw error;
	}
	const created = await getDb(env.DB).select().from(schema.generationJobs).where(eq(schema.generationJobs.id, jobId)).get();
	if (!created) throw new Error("Generation job commit did not return a row");
	await startWorkflow(env, created);
	return { job: publicJob(created, { preview: null, video: null }), replayed: false };
}

export async function getGenerationJob(env: Env, userId: string, jobId: string) {
	const row = await getDb(env.DB).select().from(schema.generationJobs)
		.where(and(eq(schema.generationJobs.id, jobId), eq(schema.generationJobs.userId, userId))).get();
	if (!row) throw new GenerationServiceError("not_found", "Generation job not found");
	const assets = await assetsForJobs(env, [row.id]);
	return publicJob(row, assets.get(row.id)!);
}

type Cursor = { createdAt: number; id: string };
function decodeCursor(value: string): Cursor {
	try {
		const parsed = JSON.parse(atob(value.replace(/-/g, "+").replace(/_/g, "/"))) as Cursor;
		if (!Number.isSafeInteger(parsed.createdAt) || typeof parsed.id !== "string" || !parsed.id) throw new Error("invalid");
		return parsed;
	} catch { throw new GenerationServiceError("validation_error", "Invalid cursor"); }
}
function encodeCursor(value: Cursor) { return btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }

export async function listGenerationJobs(env: Env, userId: string, query: unknown) {
	const parsed = ListGenerationJobsQuery.safeParse(query);
	if (!parsed.success) throw new GenerationServiceError("validation_error", parsed.error.issues[0]?.message ?? "Invalid query");
	const cursor = parsed.data.cursor ? decodeCursor(parsed.data.cursor) : null;
	const predicates = [eq(schema.generationJobs.userId, userId)];
	if (parsed.data.status) predicates.push(eq(schema.generationJobs.status, parsed.data.status));
	if (parsed.data.templateId) predicates.push(eq(schema.generationJobs.templateId, parsed.data.templateId));
	if (cursor) predicates.push(or(
		lt(schema.generationJobs.createdAt, cursor.createdAt),
		and(eq(schema.generationJobs.createdAt, cursor.createdAt), lt(schema.generationJobs.id, cursor.id)),
	)!);
	const rows = await getDb(env.DB).select().from(schema.generationJobs).where(and(...predicates))
		.orderBy(desc(schema.generationJobs.createdAt), desc(schema.generationJobs.id)).limit(parsed.data.limit + 1);
	const page = rows.slice(0, parsed.data.limit);
	const assets = await assetsForJobs(env, page.map((row) => row.id));
	const last = page.at(-1);
	return {
		items: page.map((row) => publicJob(row, assets.get(row.id)!)),
		nextCursor: rows.length > parsed.data.limit && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null,
	};
}

// P-Video does not currently guarantee provider cancellation. Only a job that
// has not entered the paid submission step can be cancelled and refunded.
const CANCELLABLE: GenerationJobState[] = ["queued"];
export async function cancelGenerationJob(env: Env, userId: string, jobId: string) {
	const db = getDb(env.DB);
	const row = await db.select().from(schema.generationJobs)
		.where(and(eq(schema.generationJobs.id, jobId), eq(schema.generationJobs.userId, userId))).get();
	if (!row) throw new GenerationServiceError("not_found", "Generation job not found");
	if (row.status === "cancelled") return getGenerationJob(env, userId, jobId);
	if (!CANCELLABLE.includes(row.status as GenerationJobState)) throw new GenerationServiceError("conflict", "Generation can no longer be cancelled");
	const now = Date.now();
	const transactionId = `tx_cancel_${jobId}`;
	const operationKey = `generation:${jobId}:cancel-release`;
	await env.DB.batch([
		env.DB.prepare(`INSERT OR IGNORE INTO token_transactions
			(id,user_id,amount,type,description,operation_key,created_at)
			SELECT ?,r.user_id,r.amount,'generation_refund',?,?,? FROM credit_reservations r
			JOIN generation_jobs j ON j.id=r.job_id
			WHERE r.job_id=? AND r.user_id=? AND r.status='reserved' AND j.status='queued'`)
			.bind(transactionId, `Released reserved credits for cancelled generation ${jobId}`, operationKey, now, jobId, userId),
		env.DB.prepare(`UPDATE user SET tokens=tokens+(
			SELECT amount FROM credit_reservations WHERE job_id=? AND user_id=?
		),updated_at=? WHERE id=?
			AND EXISTS (SELECT 1 FROM credit_reservations r JOIN generation_jobs j ON j.id=r.job_id
				WHERE r.job_id=? AND r.user_id=? AND r.status='reserved' AND j.status='queued')
			AND EXISTS (SELECT 1 FROM token_transactions WHERE id=? AND operation_key=?)`)
			.bind(jobId, userId, now, userId, jobId, userId, transactionId, operationKey),
		env.DB.prepare(`UPDATE credit_reservations
			SET status='released',settlement_transaction_id=?,settled_at=?,updated_at=?
			WHERE job_id=? AND user_id=? AND status='reserved'
			AND EXISTS (SELECT 1 FROM generation_jobs WHERE id=? AND user_id=? AND status='queued')`)
			.bind(transactionId, now, now, jobId, userId, jobId, userId),
		env.DB.prepare(`UPDATE generation_jobs SET status='cancelled',updated_at=?,completed_at=?
			WHERE id=? AND user_id=? AND status='queued'
			AND EXISTS (SELECT 1 FROM credit_reservations WHERE job_id=? AND user_id=? AND status='released')`)
			.bind(now, now, jobId, userId, jobId, userId),
		env.DB.prepare(`INSERT OR IGNORE INTO generation_job_events
			(id,job_id,operation_key,source,event_type,from_status,to_status,payload,created_at)
			SELECT ?,id,?,'api','cancel_requested',?,'cancelled','{}',? FROM generation_jobs WHERE id=? AND user_id=? AND status='cancelled'`)
			.bind(crypto.randomUUID(), `cancel:${jobId}`, row.status, now, jobId, userId),
	]);
	const current = await getGenerationJob(env, userId, jobId);
	if (current.status !== "cancelled") throw new GenerationServiceError("conflict", "Generation can no longer be cancelled");
	return current;
}

export type { StoredQuote, CreateGenerationJobRequest };

import { WorkflowEntrypoint, WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import { and, eq, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getDb, schema } from "@app/db";
import {
  GenerationJobState,
  NormalizedPVideoInput,
  isGenerationJobTransitionAllowed,
  type GenerationJobState as GenerationJobStateValue,
} from "@app/shared";
import type { Env } from "../env.js";
import { sendFcmPush } from "../providers/fcm.js";
import { generationMasterIngestUrl } from "../generation-ingest.js";
import {
  P_VIDEO_MODEL,
  P_VIDEO_VERSION,
  createPVideoPrediction,
  storePVideoOutput,
  waitForPVideoPrediction,
  type PVideoInput,
} from "../providers/p-video.js";
import { ReplicateProviderError, type ReplicatePredictionRef } from "../providers/replicate.js";
import { transitionDecision } from "./generation-lifecycle.js";
import {
  isPersistedStreamUid,
  findStreamRecoveryCandidate,
  normalizeStreamUid,
  streamLifecycleState,
  streamPendingObjectKey,
  streamRecoveryWindow,
} from "./stream-publication.js";

const InternalJobIdentity = z.object({
  jobId: z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/),
  userId: z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/),
}).strict();

type InternalJobIdentity = z.infer<typeof InternalJobIdentity>;

const ConfigurationSnapshot = z.object({
  schemaVersion: z.literal(1),
  pipelineType: z.literal("p_video"),
  template: z.object({ id: z.string().min(1), version: z.number().int().positive() }).strict(),
  pricing: z.object({ id: z.string().min(1) }).strict(),
  provider: z.object({ id: z.string().min(1), key: z.literal("replicate") }).strict(),
  model: z.object({
    id: z.string().min(1),
    key: z.literal(P_VIDEO_MODEL),
    versionId: z.string().min(1),
    versionRef: z.literal(P_VIDEO_VERSION),
  }).strict(),
  testMode: z.boolean(),
  inputMapping: z.record(z.string(), z.string()),
}).strict();

type JobContext = {
  jobId: string;
  userId: string;
  projectId: string | null;
  quotedCredits: number;
  providerId: string;
  providerModelVersionId: string;
  testMode: boolean;
  input: z.infer<typeof NormalizedPVideoInput>;
};

const STEP_RETRIES = { limit: 3, delay: "5 seconds", backoff: "exponential" } as const;
const PAID_CREATE_NO_RETRY = { limit: 0, delay: "1 second" } as const;

function changes(result: D1Result<unknown>): number {
  return result.meta.changes ?? 0;
}

function publicFailure(error: unknown): { code: string; message: string } {
  if (error instanceof ReplicateProviderError) {
    return { code: error.code, message: "Video generation failed. Reserved credits were returned." };
  }
  if (error instanceof NonRetryableError) {
    return { code: "invalid_job", message: "Video generation could not be started." };
  }
  return { code: "generation_failed", message: "Video generation failed. Reserved credits were returned." };
}

function providerInput(context: JobContext): PVideoInput {
  const input = context.testMode
    ? {
        ...context.input,
        durationSec: 1,
        resolution: "720p" as const,
        fps: 24 as const,
        draft: true,
        audioUrl: undefined,
        includeGeneratedAudio: false,
      }
    : context.input;

  return {
    prompt: input.prompt,
    image: input.imageUrl,
    audio: input.audioUrl,
    lastFrameImage: input.lastFrameImageUrl,
    duration: input.durationSec,
    aspectRatio: input.aspectRatio,
    resolution: input.resolution,
    fps: input.fps,
    draft: input.draft,
    promptUpsampling: input.promptUpsampling,
    disableSafetyFilter: false,
    saveAudio: input.includeGeneratedAudio,
    seed: input.seed,
  };
}

async function transitionJob(
  database: D1Database,
  jobId: string,
  from: GenerationJobStateValue,
  to: GenerationJobStateValue,
  progress: number,
): Promise<void> {
  if (!isGenerationJobTransitionAllowed(from, to)) {
    throw new NonRetryableError(`Unsupported generation transition ${from} -> ${to}`, "InvalidTransition");
  }
  const currentRow = await database.prepare("SELECT status FROM generation_jobs WHERE id = ?1").bind(jobId).first<{ status: string }>();
  if (!currentRow) throw new NonRetryableError("Generation job not found", "JobNotFound");
  const current = GenerationJobState.parse(currentRow.status);
  const decision = transitionDecision(current, from, to);
  if (decision === "already_applied") return;
  if (decision === "reject") {
    throw new NonRetryableError(`Generation job is ${current}; expected ${from}`, "InvalidJobState");
  }

  const now = Date.now();
  const operationKey = `transition:${from}:${to}`;
  const eventId = `evt_${jobId}_${from}_${to}`;
  const results = await database.batch([
    database.prepare(`
      INSERT OR IGNORE INTO generation_job_events
        (id, job_id, operation_key, source, event_type, from_status, to_status, created_at)
      SELECT ?1, id, ?2, 'workflow', 'state_transition', ?3, ?4, ?5
      FROM generation_jobs WHERE id = ?6 AND status = ?3
    `).bind(eventId, operationKey, from, to, now, jobId),
    database.prepare(`
      UPDATE generation_jobs SET status = ?1, progress = ?2, updated_at = ?3
      WHERE id = ?4 AND status = ?5
    `).bind(to, progress, now, jobId, from),
  ]);
  if (changes(results[1]) === 0) {
    const row = await database.prepare("SELECT status FROM generation_jobs WHERE id = ?1").bind(jobId).first<{ status: string }>();
    if (row?.status !== to) throw new Error(`Failed to persist generation transition ${from} -> ${to}`);
  }
}

async function loadAndValidate(env: Env, identity: InternalJobIdentity, instanceId: string): Promise<JobContext> {
  const db = getDb(env.DB);
  const [job] = await db.select().from(schema.generationJobs).where(and(
    eq(schema.generationJobs.id, identity.jobId),
    eq(schema.generationJobs.userId, identity.userId),
  )).limit(1);
  if (!job) throw new NonRetryableError("Generation job not found for user", "JobNotFound");
  if (job.workflowInstanceId !== instanceId) {
    throw new NonRetryableError("Generation workflow identity does not match job", "WorkflowMismatch");
  }
  if (GenerationJobState.parse(job.status) !== "queued") {
    throw new NonRetryableError(`Generation job is not queued`, "InvalidJobState");
  }

  const snapshot = ConfigurationSnapshot.parse(job.configurationSnapshot);
  const input = NormalizedPVideoInput.parse(job.normalizedInputs);
  if (snapshot.template.id !== job.templateVersionId || snapshot.pricing.id !== job.pricingVersionId) {
    throw new NonRetryableError("Immutable job snapshot does not match job references", "SnapshotMismatch");
  }
  const [reservation] = await db.select().from(schema.creditReservations).where(and(
    eq(schema.creditReservations.jobId, job.id),
    eq(schema.creditReservations.userId, job.userId),
  )).limit(1);
  if (!reservation || reservation.status !== "reserved" || reservation.amount !== job.quotedCredits) {
    throw new NonRetryableError("Generation job has no matching credit reservation", "ReservationMismatch");
  }

  return {
    jobId: job.id,
    userId: job.userId,
    projectId: job.projectId,
    quotedCredits: job.quotedCredits,
    providerId: snapshot.provider.id,
    providerModelVersionId: snapshot.model.versionId,
    testMode: snapshot.testMode,
    input,
  };
}

async function ensureAttempt(env: Env, context: JobContext): Promise<{ attemptId: string }> {
  const attemptId = `attempt_${context.jobId}_1`;
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(`
      INSERT OR IGNORE INTO generation_attempts
        (id, job_id, attempt_number, provider_id, provider_model_version_id, status, request_metadata, created_at)
      VALUES (?1, ?2, 1, ?3, ?4, 'created', ?5, ?6)
    `).bind(
      attemptId,
      context.jobId,
      context.providerId,
      context.providerModelVersionId,
      JSON.stringify({ model: P_VIDEO_MODEL, version: P_VIDEO_VERSION, testMode: context.testMode }),
      now,
    ),
    env.DB.prepare(`
      INSERT OR IGNORE INTO generation_job_events
        (id, job_id, attempt_id, provider_id, operation_key, source, event_type, payload, created_at)
      VALUES (?1, ?2, ?3, ?4, 'attempt:1:created', 'workflow', 'attempt_created', ?5, ?6)
    `).bind(`evt_${context.jobId}_attempt_1`, context.jobId, attemptId, context.providerId, JSON.stringify({ attemptNumber: 1 }), now),
  ]);
  const attempt = await env.DB.prepare(`
    SELECT provider_id, provider_model_version_id FROM generation_attempts WHERE id = ?1 AND job_id = ?2
  `).bind(attemptId, context.jobId).first<{ provider_id: string; provider_model_version_id: string }>();
  if (!attempt || attempt.provider_id !== context.providerId || attempt.provider_model_version_id !== context.providerModelVersionId) {
    throw new NonRetryableError("Generation attempt conflicts with immutable routing", "AttemptMismatch");
  }
  return { attemptId };
}

async function persistPrediction(
  env: Env,
  context: JobContext,
  attemptId: string,
  prediction: ReplicatePredictionRef,
): Promise<void> {
  const now = Date.now();
  const result = await env.DB.batch([
    env.DB.prepare(`
      UPDATE generation_attempts
      SET provider_job_id = ?1, status = ?2, response_metadata = ?3, started_at = COALESCE(started_at, ?4)
      WHERE id = ?5 AND job_id = ?6 AND provider_job_id IS NULL
    `).bind(
      prediction.id,
      prediction.status === "succeeded" ? "succeeded" : "processing",
      JSON.stringify({ predictionId: prediction.id, version: prediction.version, status: prediction.status }),
      now,
      attemptId,
      context.jobId,
    ),
    env.DB.prepare(`
      INSERT OR IGNORE INTO generation_job_events
        (id, job_id, attempt_id, provider_id, provider_event_id, operation_key, source, event_type, payload, created_at)
      VALUES (?1, ?2, ?3, ?4, ?5, 'provider:prediction:created', 'provider', 'prediction_created', ?6, ?7)
    `).bind(
      `evt_${context.jobId}_prediction_created`,
      context.jobId,
      attemptId,
      context.providerId,
      `${prediction.id}:created`,
      JSON.stringify({ predictionId: prediction.id, version: prediction.version, status: prediction.status }),
      now,
    ),
  ]);
  if (changes(result[0]) === 0) {
    const existing = await env.DB.prepare("SELECT provider_job_id FROM generation_attempts WHERE id = ?1").bind(attemptId).first<{ provider_job_id: string | null }>();
    if (existing?.provider_job_id !== prediction.id) throw new Error("Could not persist provider prediction identity");
  }
}

async function markPredictionSucceeded(env: Env, context: JobContext, attemptId: string): Promise<void> {
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(`
      UPDATE generation_attempts SET status = 'succeeded', response_metadata = ?1, finished_at = ?2
      WHERE id = ?3 AND job_id = ?4
    `).bind(JSON.stringify({ version: P_VIDEO_VERSION, status: "succeeded" }), now, attemptId, context.jobId),
    env.DB.prepare(`
      INSERT OR IGNORE INTO generation_job_events
        (id, job_id, attempt_id, provider_id, operation_key, source, event_type, payload, created_at)
      VALUES (?1, ?2, ?3, ?4, 'provider:prediction:succeeded', 'provider', 'prediction_succeeded', ?5, ?6)
    `).bind(
      `evt_${context.jobId}_prediction_succeeded`, context.jobId, attemptId, context.providerId,
      JSON.stringify({ version: P_VIDEO_VERSION }), now,
    ),
  ]);
}

async function recordMasterAsset(
  env: Env,
  context: JobContext,
  attemptId: string,
  stored: { key: string; contentType: "video/mp4"; bytes: number; etag: string },
): Promise<void> {
  const now = Date.now();
  await env.DB.prepare(`
    INSERT INTO generation_assets
      (id, job_id, attempt_id, kind, storage, object_key, content_type, byte_size, checksum, status, created_at, ready_at)
    VALUES (?1, ?2, ?3, 'video_master', 'r2', ?4, ?5, ?6, ?7, 'ready', ?8, ?8)
    ON CONFLICT(storage, object_key) DO UPDATE SET
      attempt_id = excluded.attempt_id,
      content_type = excluded.content_type,
      byte_size = excluded.byte_size,
      checksum = excluded.checksum,
      status = 'ready',
      ready_at = excluded.ready_at
  `).bind(
    `asset_${context.jobId}_master`, context.jobId, attemptId, stored.key,
    stored.contentType, stored.bytes, stored.etag, now,
  ).run();
}

type StreamPublication = {
  uid: string;
  readyToStream: boolean;
  statusState: string;
};

async function ensureStreamAsset(env: Env, context: JobContext, attemptId: string): Promise<{ objectKey: string; createdAt: number }> {
  const pendingKey = streamPendingObjectKey(context.jobId);
  await env.DB.prepare(`
    INSERT OR IGNORE INTO generation_assets
      (id, job_id, attempt_id, kind, storage, object_key, content_type, status, created_at)
    VALUES (?1, ?2, ?3, 'playback', 'stream', ?4, 'video/mp4', 'pending', ?5)
  `).bind(`asset_${context.jobId}_stream`, context.jobId, attemptId, pendingKey, Date.now()).run();
  const asset = await env.DB.prepare(`
    SELECT job_id, storage, object_key, created_at FROM generation_assets WHERE id = ?1
  `).bind(`asset_${context.jobId}_stream`).first<{ job_id: string; storage: string; object_key: string; created_at: number }>();
  if (!asset || asset.job_id !== context.jobId || asset.storage !== "stream") {
    throw new NonRetryableError("Stream publication asset conflicts with job", "StreamAssetMismatch");
  }
  return { objectKey: asset.object_key, createdAt: asset.created_at };
}

function publicationFromVideo(video: StreamVideo): StreamPublication {
  const uid = normalizeStreamUid(video);
  if (!uid) throw new Error("Stream returned a video without a valid identifier");
  return { uid, readyToStream: video.readyToStream, statusState: video.status.state };
}

async function findExistingStreamPublication(
  env: Env,
  context: JobContext,
  streamAssetCreatedAt: number,
): Promise<StreamPublication | null> {
  const initial = streamRecoveryWindow(streamAssetCreatedAt, Date.now());
  const windows: Array<{ after: number; before: number }> = [{
    after: Date.parse(initial.after),
    before: Date.parse(initial.before),
  }];
  const limit = 1000;
  for (let query = 0; windows.length > 0 && query < 64; query += 1) {
    const window = windows.shift()!;
    const videos = await env.STREAM.videos.list({
      limit,
      after: new Date(window.after).toISOString(),
      afterComp: "gte",
      before: new Date(window.before).toISOString(),
      beforeComp: "lt",
    });
    const existing = findStreamRecoveryCandidate(videos, context.userId, context.jobId);
    if (existing) return publicationFromVideo(existing);
    if (videos.length >= limit) {
      const midpoint = Math.floor((window.after + window.before) / 2);
      if (midpoint <= window.after || midpoint >= window.before) {
        throw new Error("Stream recovery window is ambiguous; refusing a duplicate upload");
      }
      windows.unshift({ after: midpoint, before: window.before }, { after: window.after, before: midpoint });
    }
  }
  if (windows.length > 0) throw new Error("Stream recovery query limit reached; refusing a duplicate upload");
  return null;
}

async function publishMasterToStream(
  env: Env,
  context: JobContext,
  masterAssetKey: string,
  streamAssetCreatedAt: number,
): Promise<StreamPublication> {
  const asset = await env.DB.prepare(`
    SELECT object_key FROM generation_assets WHERE id = ?1 AND job_id = ?2 AND storage = 'stream'
  `).bind(`asset_${context.jobId}_stream`, context.jobId).first<{ object_key: string }>();
  if (asset && isPersistedStreamUid(asset.object_key, context.jobId)) {
    return publicationFromVideo(await env.STREAM.video(asset.object_key).details());
  }

  // Recover a remote side effect if the Worker died after Stream accepted the
  // URL but before the Workflow could checkpoint the return value.
  const discovered = await findExistingStreamPublication(env, context, streamAssetCreatedAt);
  if (discovered) return discovered;

  try {
    const ingestUrl = await generationMasterIngestUrl(
      env.APP_BASE_URL,
      env.MEDIA_INGEST_SIGNING_SECRET,
      masterAssetKey,
      Math.floor(streamAssetCreatedAt / 1000),
    );
    return publicationFromVideo(await env.STREAM.upload(ingestUrl, {
      creator: context.userId,
      meta: {
        generationJobId: context.jobId,
        masterAssetKey,
      },
      requireSignedURLs: true,
    }));
  } catch (error) {
    // Stream deduplicates URL uploads. Normalize that response by discovering
    // the video carrying this job's immutable metadata instead of re-uploading.
    if (error instanceof Error && error.name === "AlreadyUploadedError") {
      const existing = await findExistingStreamPublication(env, context, streamAssetCreatedAt);
      if (existing) return existing;
    }
    throw error;
  }
}

async function persistStreamUid(env: Env, context: JobContext, publication: StreamPublication): Promise<void> {
  const pendingKey = streamPendingObjectKey(context.jobId);
  const result = await env.DB.prepare(`
    UPDATE generation_assets SET object_key = ?1
    WHERE id = ?2 AND job_id = ?3 AND storage = 'stream' AND object_key = ?4
  `).bind(publication.uid, `asset_${context.jobId}_stream`, context.jobId, pendingKey).run();
  if (changes(result) === 0) {
    const existing = await env.DB.prepare(`
      SELECT object_key FROM generation_assets WHERE id = ?1 AND job_id = ?2 AND storage = 'stream'
    `).bind(`asset_${context.jobId}_stream`, context.jobId).first<{ object_key: string }>();
    if (existing?.object_key !== publication.uid) throw new Error("Could not persist Stream video identity");
  }
}

async function markStreamAssetReady(env: Env, context: JobContext, uid: string): Promise<void> {
  const now = Date.now();
  const result = await env.DB.prepare(`
    UPDATE generation_assets SET status = 'ready', ready_at = COALESCE(ready_at, ?1)
    WHERE id = ?2 AND job_id = ?3 AND storage = 'stream' AND object_key = ?4
  `).bind(now, `asset_${context.jobId}_stream`, context.jobId, uid).run();
  if (changes(result) === 0) throw new Error("Could not mark Stream playback asset ready");
}

async function captureAndComplete(env: Env, context: JobContext): Promise<void> {
  const now = Date.now();
  const transactionId = `tx_capture_${context.jobId}`;
  const operationKey = `generation:${context.jobId}:capture`;
  await env.DB.batch([
    env.DB.prepare(`
      INSERT OR IGNORE INTO token_transactions
        (id, user_id, amount, type, description, project_id, operation_key, created_at)
      SELECT ?1, user_id, 0, 'generation_capture', ?2, ?3, ?4, ?5
      FROM credit_reservations WHERE job_id = ?6 AND user_id = ?7 AND status IN ('reserved', 'captured')
    `).bind(
      transactionId, `Captured reserved credits for generation ${context.jobId}`,
      context.projectId, operationKey, now, context.jobId, context.userId,
    ),
    env.DB.prepare(`
      UPDATE credit_reservations
      SET status = 'captured', settlement_transaction_id = ?1, settled_at = ?2, updated_at = ?2
      WHERE job_id = ?3 AND user_id = ?4 AND status = 'reserved'
    `).bind(transactionId, now, context.jobId, context.userId),
    env.DB.prepare(`
      INSERT OR IGNORE INTO generation_job_events
        (id, job_id, operation_key, source, event_type, from_status, to_status, payload, created_at)
      SELECT ?1, id, 'transition:publishing:completed', 'workflow', 'state_transition',
        'publishing', 'completed', ?2, ?3
      FROM generation_jobs WHERE id = ?4 AND user_id = ?5 AND status = 'publishing'
    `).bind(
      `evt_${context.jobId}_publishing_completed`, JSON.stringify({ settlement: "captured" }), now,
      context.jobId, context.userId,
    ),
    env.DB.prepare(`
      UPDATE generation_jobs
      SET status = 'completed', progress = 100,
        error_code = NULL, error_message = NULL, completed_at = ?1, updated_at = ?1
      WHERE id = ?2 AND user_id = ?3 AND status = 'publishing'
        AND EXISTS (
          SELECT 1 FROM credit_reservations
          WHERE job_id = ?2 AND user_id = ?3 AND status = 'captured'
        )
    `).bind(now, context.jobId, context.userId),
  ]);

  const state = await env.DB.prepare(`
    SELECT j.status AS job_status, r.status AS reservation_status
    FROM generation_jobs j JOIN credit_reservations r ON r.job_id = j.id
    WHERE j.id = ?1 AND j.user_id = ?2
  `).bind(context.jobId, context.userId).first<{ job_status: string; reservation_status: string }>();
  if (state?.job_status !== "completed" || state.reservation_status !== "captured") {
    throw new Error("Could not atomically complete generation settlement");
  }
}

async function releaseAndFail(env: Env, identity: InternalJobIdentity, error: unknown): Promise<void> {
  const failure = publicFailure(error);
  const now = Date.now();
  const transactionId = `tx_release_${identity.jobId}`;
  const operationKey = `generation:${identity.jobId}:release`;
  await env.DB.batch([
    env.DB.prepare(`
      INSERT OR IGNORE INTO token_transactions
        (id, user_id, amount, type, description, project_id, operation_key, created_at)
      SELECT ?1, r.user_id, r.amount, 'generation_refund', ?2, j.project_id, ?3, ?4
      FROM credit_reservations r JOIN generation_jobs j ON j.id = r.job_id
      WHERE r.job_id = ?5 AND r.user_id = ?6 AND r.status = 'reserved'
    `).bind(
      transactionId, `Released reserved credits for failed generation ${identity.jobId}`,
      operationKey, now, identity.jobId, identity.userId,
    ),
    env.DB.prepare(`
      UPDATE user SET tokens = tokens + (
        SELECT amount FROM credit_reservations WHERE job_id = ?1 AND user_id = ?2
      ), updated_at = ?3
      WHERE id = ?2
        AND EXISTS (SELECT 1 FROM credit_reservations WHERE job_id = ?1 AND user_id = ?2 AND status = 'reserved')
        AND EXISTS (SELECT 1 FROM token_transactions WHERE id = ?4 AND operation_key = ?5)
    `).bind(identity.jobId, identity.userId, now, transactionId, operationKey),
    env.DB.prepare(`
      UPDATE credit_reservations
      SET status = 'released', settlement_transaction_id = ?1, settled_at = ?2, updated_at = ?2
      WHERE job_id = ?3 AND user_id = ?4 AND status = 'reserved'
    `).bind(transactionId, now, identity.jobId, identity.userId),
    env.DB.prepare(`
      UPDATE generation_attempts
      SET status = 'failed', error_class = ?1, error_code = ?2, finished_at = ?3
      WHERE job_id = ?4 AND status NOT IN ('succeeded', 'failed')
    `).bind(error instanceof Error ? error.name : "Error", failure.code, now, identity.jobId),
    env.DB.prepare(`
      INSERT OR IGNORE INTO generation_job_events
        (id, job_id, operation_key, source, event_type, from_status, to_status, payload, created_at)
      SELECT ?1, id, 'transition:any:failed', 'workflow', 'state_transition', status, 'failed', ?2, ?3
      FROM generation_jobs
      WHERE id = ?4 AND user_id = ?5 AND status NOT IN ('completed', 'failed', 'cancelled')
    `).bind(
      `evt_${identity.jobId}_failed`, JSON.stringify({ code: failure.code }), now,
      identity.jobId, identity.userId,
    ),
    env.DB.prepare(`
      UPDATE generation_jobs SET status = 'failed', error_code = ?1, error_message = ?2, updated_at = ?3
      WHERE id = ?4 AND user_id = ?5 AND status NOT IN ('completed', 'failed', 'cancelled')
    `).bind(failure.code, failure.message, now, identity.jobId, identity.userId),
  ]);
  console.error(JSON.stringify({ event: "p_video_generation_failed", jobId: identity.jobId, code: failure.code }));
}

async function notifyBestEffort(env: Env, identity: InternalJobIdentity, completed: boolean): Promise<void> {
  try {
    const db = getDb(env.DB);
    const [job] = await db.select({ projectId: schema.generationJobs.projectId })
      .from(schema.generationJobs)
      .where(and(eq(schema.generationJobs.id, identity.jobId), eq(schema.generationJobs.userId, identity.userId)))
      .limit(1);
    if (!job) return;
    const notificationId = `notification_${identity.jobId}_${completed ? "completed" : "failed"}`;
    const notificationType = completed ? "generation_complete" : "system";
    const dedupeKey = `p_video:${identity.jobId}:${completed ? "completed" : "failed"}`;
    await env.DB.prepare(`
      INSERT OR IGNORE INTO notifications
        (id, user_id, type, title, message, project_id, job_id, deep_link,
         dedupe_key, metadata, is_read, push_sent, email_sent, created_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 0, 0, 0, ?11)
    `).bind(
      notificationId,
      identity.userId,
      notificationType,
      completed ? "Your video is ready" : "Video generation failed",
      completed ? "Your generated video is ready to view." : "Generation failed and your reserved credits were returned.",
      job.projectId,
      identity.jobId,
      `/generation/${identity.jobId}`,
      dedupeKey,
      JSON.stringify({ jobId: identity.jobId, outcome: completed ? "completed" : "failed" }),
      Date.now(),
    ).run();

    const preferences = await db.select({
      pushEnabled: schema.notificationPreferences.pushEnabled,
      emailEnabled: schema.notificationPreferences.emailEnabled,
      generationUpdates: schema.notificationPreferences.generationUpdates,
    }).from(schema.notificationPreferences)
      .where(eq(schema.notificationPreferences.userId, identity.userId))
      .get();
    const generationEnabled=preferences?.generationUpdates ?? true;
    if (generationEnabled && (preferences?.pushEnabled ?? true)) {
      const devices = await db.select({ token: schema.devices.fcmToken })
        .from(schema.devices).where(and(eq(schema.devices.userId, identity.userId),isNull(schema.devices.disabledAt)));
      const push = await sendFcmPush(env.FCM_SERVICE_ACCOUNT_JSON, devices.map((device) => device.token), {
        title: completed ? "Your video is ready" : "Video generation failed",
        body: completed ? "Tap to view your generated video." : "Your reserved credits were returned.",
        data: { jobId: identity.jobId, type: completed ? "generation_complete" : "generation_failed" },
      });
      if (push.sent > 0) await env.DB.prepare("UPDATE notifications SET push_sent = 1 WHERE id = ?1").bind(notificationId).run();
    }
    if(generationEnabled && preferences?.emailEnabled){
      const recipient=await env.DB.prepare("SELECT email FROM user WHERE id=?").bind(identity.userId).first<{email:string}>();
      const claim=await env.DB.prepare("UPDATE notifications SET email_sent=1 WHERE id=? AND email_sent=0").bind(notificationId).run();
      if(recipient?.email&&(claim.meta.changes??0)===1){try{const subject=completed?"Your Zellyo video is ready":"Zellyo video generation failed";const text=completed?"Your generated video is ready in Zellyo.":"Generation failed and your reserved credits were returned.";await env.EMAIL.send({to:recipient.email,from:{email:env.EMAIL_FROM_ADDRESS,name:env.EMAIL_FROM_NAME},subject,text,html:`<p>${text}</p>`});}catch(error){await env.DB.prepare("UPDATE notifications SET email_sent=0 WHERE id=?").bind(notificationId).run();throw error;}}
    }
  } catch (notificationError) {
    console.error(JSON.stringify({
      event: "p_video_notification_failed",
      jobId: identity.jobId,
      error: notificationError instanceof Error ? notificationError.message : String(notificationError),
    }));
  }
}

/** First production P-Video vertical slice. Only immutable job identity crosses the Workflow boundary. */
export class PVideoGenerationWorkflow extends WorkflowEntrypoint<Env, InternalJobIdentity> {
  async run(event: WorkflowEvent<InternalJobIdentity>, step: WorkflowStep): Promise<{ jobId: string; assetKey: string }> {
    const identity = InternalJobIdentity.parse(event.payload);
    try {
      const context = await step.do("load-and-validate-job", { retries: STEP_RETRIES, timeout: "1 minute" }, () =>
        loadAndValidate(this.env, identity, event.instanceId));

      const attempt = await step.do("create-attempt", { retries: STEP_RETRIES, timeout: "1 minute" }, () =>
        ensureAttempt(this.env, context));
      await step.do("transition-to-submitting", { retries: STEP_RETRIES, timeout: "1 minute" }, () =>
        transitionJob(this.env.DB, context.jobId, "queued", "submitting", 10));

      // This is the only paid create. A persistence/network ambiguity is failed and
      // compensated rather than retried into a duplicate paid prediction.
      const prediction = await step.do(
        "create-paid-p-video-prediction",
        { retries: PAID_CREATE_NO_RETRY, timeout: "45 seconds", sensitive: "output" },
        async () => {
          const created = await createPVideoPrediction(this.env, providerInput(context));
          await persistPrediction(this.env, context, attempt.attemptId, created);
          return created;
        },
      );
      await step.do("transition-to-provider-processing", { retries: STEP_RETRIES, timeout: "1 minute" }, () =>
        transitionJob(this.env.DB, context.jobId, "submitting", "provider_processing", 25));

      const outputUrl = await step.do(
        "wait-for-existing-p-video-prediction",
        { retries: STEP_RETRIES, timeout: "8 minutes", sensitive: "output" },
        () => waitForPVideoPrediction(this.env, prediction, 6 * 60_000),
      );
      await step.do("record-prediction-success", { retries: STEP_RETRIES, timeout: "1 minute" }, () =>
        markPredictionSucceeded(this.env, context, attempt.attemptId));
      await step.do("transition-to-ingesting", { retries: STEP_RETRIES, timeout: "1 minute" }, () =>
        transitionJob(this.env.DB, context.jobId, "provider_processing", "ingesting", 70));

      const assetKey = `users/${context.userId}/generation-jobs/${context.jobId}/master.mp4`;
      const stored = await step.do(
        "stream-p-video-master-to-r2",
        { retries: STEP_RETRIES, timeout: "3 minutes" },
        () => storePVideoOutput(this.env.ASSETS_BUCKET, assetKey, outputUrl, prediction.version),
      );
      await step.do("record-r2-master-asset", { retries: STEP_RETRIES, timeout: "1 minute" }, () =>
        recordMasterAsset(this.env, context, attempt.attemptId, stored));
      await step.do("transition-to-post-processing", { retries: STEP_RETRIES, timeout: "1 minute" }, () =>
        transitionJob(this.env.DB, context.jobId, "ingesting", "post_processing", 85));
      await step.do("transition-to-publishing", { retries: STEP_RETRIES, timeout: "1 minute" }, () =>
        transitionJob(this.env.DB, context.jobId, "post_processing", "publishing", 95));

      const streamAsset = await step.do(
        "reserve-stream-playback-asset",
        { retries: STEP_RETRIES, timeout: "1 minute" },
        () => ensureStreamAsset(this.env, context, attempt.attemptId),
      );
      let publication = isPersistedStreamUid(streamAsset.objectKey, context.jobId)
        ? await step.do(
            "load-persisted-stream-video",
            { retries: STEP_RETRIES, timeout: "1 minute" },
            async () => publicationFromVideo(await this.env.STREAM.video(streamAsset.objectKey).details()),
          )
        : await step.do(
            "upload-r2-master-to-stream",
            { retries: STEP_RETRIES, timeout: "2 minutes", sensitive: "output" },
            () => publishMasterToStream(this.env, context, assetKey, streamAsset.createdAt),
          );
      await step.do("persist-stream-video-uid", { retries: STEP_RETRIES, timeout: "1 minute" }, () =>
        persistStreamUid(this.env, context, publication));

      for (let poll = 0; streamLifecycleState(publication.readyToStream, publication.statusState) === "processing"; poll += 1) {
        if (poll >= 60) throw new Error("Stream video processing timed out");
        await step.sleep(`wait-for-stream-video-${poll}`, "10 seconds");
        publication = await step.do(
          `check-stream-video-${poll}`,
          { retries: STEP_RETRIES, timeout: "1 minute" },
          async () => publicationFromVideo(await this.env.STREAM.video(publication.uid).details()),
        );
      }
      if (streamLifecycleState(publication.readyToStream, publication.statusState) === "failed") {
        throw new NonRetryableError("Stream could not process the generated video", "StreamProcessingFailed");
      }
      await step.do("mark-stream-playback-ready", { retries: STEP_RETRIES, timeout: "1 minute" }, () =>
        markStreamAssetReady(this.env, context, publication.uid));
      await step.do("capture-reservation-and-complete", { retries: STEP_RETRIES, timeout: "1 minute" }, () =>
        captureAndComplete(this.env, context));

      // The job and credit settlement are already terminal. Notification failures
      // are observed but deliberately cannot change the completed outcome.
      await step.do("notify-completion-best-effort", { retries: { limit: 0, delay: "1 second" }, timeout: "1 minute" }, async () => {
        await notifyBestEffort(this.env, identity, true);
      });
      return { jobId: context.jobId, assetKey };
    } catch (error) {
      await step.do("release-reservation-and-fail", { retries: STEP_RETRIES, timeout: "1 minute" }, () =>
        releaseAndFail(this.env, identity, error));
      await step.do("notify-failure-best-effort", { retries: { limit: 0, delay: "1 second" }, timeout: "1 minute" }, async () => {
        await notifyBestEffort(this.env, identity, false);
      });
      throw error;
    }
  }
}

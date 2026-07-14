export type PVideoPersistenceContext = {
  jobId: string;
  userId: string;
  projectId: string | null;
};

export async function recordPVideoMasterAsset(
  database: D1Database,
  context: PVideoPersistenceContext,
  attemptId: string,
  stored: { key: string; contentType: "video/mp4"; bytes: number; etag: string },
  now = Date.now(),
): Promise<void> {
  await database.prepare(`
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

export async function capturePVideoReservationAndComplete(
  database: D1Database,
  context: PVideoPersistenceContext,
  now = Date.now(),
): Promise<void> {
  const transactionId = `tx_capture_${context.jobId}`;
  const operationKey = `generation:${context.jobId}:capture`;
  await database.batch([
    database.prepare(`
      INSERT OR IGNORE INTO token_transactions
        (id, user_id, amount, type, description, project_id, operation_key, created_at)
      SELECT ?1, user_id, 0, 'generation_capture', ?2, ?3, ?4, ?5
      FROM credit_reservations WHERE job_id = ?6 AND user_id = ?7 AND status IN ('reserved', 'captured')
    `).bind(
      transactionId, `Captured reserved credits for generation ${context.jobId}`,
      context.projectId, operationKey, now, context.jobId, context.userId,
    ),
    database.prepare(`
      UPDATE credit_reservations
      SET status = 'captured', settlement_transaction_id = ?1, settled_at = ?2, updated_at = ?2
      WHERE job_id = ?3 AND user_id = ?4 AND status = 'reserved'
    `).bind(transactionId, now, context.jobId, context.userId),
    database.prepare(`
      INSERT OR IGNORE INTO generation_job_events
        (id, job_id, operation_key, source, event_type, from_status, to_status, payload, created_at)
      SELECT ?1, id, 'transition:publishing:completed', 'workflow', 'state_transition',
        'publishing', 'completed', ?2, ?3
      FROM generation_jobs WHERE id = ?4 AND user_id = ?5 AND status = 'publishing'
    `).bind(
      `evt_${context.jobId}_publishing_completed`, JSON.stringify({ settlement: "captured" }), now,
      context.jobId, context.userId,
    ),
    database.prepare(`
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

  const state = await database.prepare(`
    SELECT j.status AS job_status, r.status AS reservation_status
    FROM generation_jobs j JOIN credit_reservations r ON r.job_id = j.id
    WHERE j.id = ?1 AND j.user_id = ?2
  `).bind(context.jobId, context.userId).first<{ job_status: string; reservation_status: string }>();
  if (state?.job_status !== "completed" || state.reservation_status !== "captured") {
    throw new Error("Could not atomically complete generation settlement");
  }
}

export async function insertPVideoOutcomeNotification(
  database: D1Database,
  identity: { jobId: string; userId: string },
  projectId: string | null,
  completed: boolean,
  now = Date.now(),
): Promise<string> {
  const notificationId = `notification_${identity.jobId}_${completed ? "completed" : "failed"}`;
  const notificationType = completed ? "generation_complete" : "system";
  const dedupeKey = `p_video:${identity.jobId}:${completed ? "completed" : "failed"}`;
  await database.prepare(`
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
    projectId,
    identity.jobId,
    `/generation/${identity.jobId}`,
    dedupeKey,
    JSON.stringify({ jobId: identity.jobId, outcome: completed ? "completed" : "failed" }),
    now,
  ).run();
  return notificationId;
}

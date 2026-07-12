export const STREAM_PENDING_OBJECT_KEY_PREFIX = "pending:";

export type StreamLifecycleState = "ready" | "processing" | "failed";

/** Pure lifecycle decision used by the durable polling loop. */
export function streamLifecycleState(
  readyToStream: boolean,
  statusState: string,
): StreamLifecycleState {
  if (readyToStream) return "ready";
  const normalized = statusState.trim().toLowerCase();
  return normalized === "error" || normalized === "failed" ? "failed" : "processing";
}

export function streamPendingObjectKey(jobId: string): string {
  return `${STREAM_PENDING_OBJECT_KEY_PREFIX}${jobId}`;
}

export function isPersistedStreamUid(objectKey: string, jobId: string): boolean {
  return objectKey !== streamPendingObjectKey(jobId) && /^[A-Za-z0-9_-]{8,128}$/.test(objectKey);
}

/** Current binding returns `id`; older/REST-shaped responses use `uid`. */
export function normalizeStreamUid(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const candidate = typeof record.id === "string" ? record.id
    : typeof record.uid === "string" ? record.uid
    : null;
  return candidate && /^[A-Za-z0-9_-]{8,128}$/.test(candidate) ? candidate : null;
}

export type StreamRecoveryCandidate = {
  creator?: unknown;
  meta?: unknown;
};

export function matchesStreamRecoveryCandidate(
  video: StreamRecoveryCandidate,
  userId: string,
  jobId: string,
): boolean {
  if (video.creator !== userId || !video.meta || typeof video.meta !== "object" || Array.isArray(video.meta)) return false;
  return (video.meta as Record<string, unknown>).generationJobId === jobId;
}

export function findStreamRecoveryCandidate<T extends StreamRecoveryCandidate>(
  videos: readonly T[],
  userId: string,
  jobId: string,
): T | null {
  return videos.find((video) => matchesStreamRecoveryCandidate(video, userId, jobId)) ?? null;
}

export function streamRecoveryWindow(createdAtMs: number, nowMs: number): { after: string; before: string } {
  const latestPossibleUpload = Math.min(nowMs, createdAtMs + 20 * 60_000);
  return {
    after: new Date(Math.max(0, createdAtMs - 60_000)).toISOString(),
    before: new Date(latestPossibleUpload + 60_000).toISOString(),
  };
}

export const EXPORT_CHUNK_LIMIT = 4_000;
export const EXPORT_MANIFEST_BYTE_LIMIT = 750_000;

export function exportWithinLimits(chunks: number, manifestBytes: number): boolean {
  return chunks <= EXPORT_CHUNK_LIMIT && manifestBytes <= EXPORT_MANIFEST_BYTE_LIMIT;
}

export function deletionClaimMatches(
  input: { status: string; workflowInstanceId: string | null; scheduledFor: number },
  instanceId: string,
  now: number,
): boolean {
  return input.status === "scheduled" && input.workflowInstanceId === instanceId && input.scheduledFor <= now;
}

export function streamDeleteIsAlreadyGone(error: unknown): boolean {
  const value = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /(?:404|not[ -]?found|does not exist)/i.test(value);
}

export function shouldContinuePrefixSweep(deletedCount: number): boolean {
  return deletedCount > 0;
}

export const STUCK_RENDER_AFTER_MS = 30 * 60 * 1000;

export function stuckRenderCutoff(now: number): number {
	return now - STUCK_RENDER_AFTER_MS;
}

export function isReapableRenderJob(status: string, updatedAt: number, now: number): boolean {
	return (status === "queued" || status === "rendering") && updatedAt < stuckRenderCutoff(now);
}

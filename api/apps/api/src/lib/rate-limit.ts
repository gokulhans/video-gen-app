import type { Env } from "../env";

/**
 * Simple fixed-window per-user-per-minute counter backed by KV.
 * Not perfectly precise under race conditions (KV is eventually consistent),
 * but good enough to blunt abusive bursts on expensive endpoints.
 */
export async function checkRateLimit(
	env: Env,
	userId: string,
	bucket: string,
	limitPerMinute: number,
): Promise<{ allowed: boolean; remaining: number }> {
	const windowMinute = Math.floor(Date.now() / 60_000);
	const key = `ratelimit:${bucket}:${userId}:${windowMinute}`;

	const current = Number((await env.KV.get(key)) ?? "0");
	if (current >= limitPerMinute) {
		return { allowed: false, remaining: 0 };
	}

	// Best-effort increment; expires shortly after the window closes.
	await env.KV.put(key, String(current + 1), { expirationTtl: 90 });
	return { allowed: true, remaining: limitPerMinute - current - 1 };
}

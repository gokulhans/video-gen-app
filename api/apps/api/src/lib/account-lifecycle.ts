const REAUTHENTICATION_WINDOW_MS = 15 * 60_000;

/**
 * A deletion confirmation must use a session created after the request and
 * within the short reauthentication window. Better Auth stores sessions in
 * KV in this deployment, so callers must use the authenticated session
 * returned by Better Auth rather than querying the unused D1 session table.
 */
export function isFreshReauthenticationSession(
	sessionCreatedAt: number,
	requestCreatedAt: number,
	now: number,
): boolean {
	return Number.isFinite(sessionCreatedAt)
		&& sessionCreatedAt > requestCreatedAt
		&& sessionCreatedAt <= now
		&& now - sessionCreatedAt <= REAUTHENTICATION_WINDOW_MS;
}

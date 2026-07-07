import type { Context, Next } from "hono";
import { createAuth } from "../lib/auth";
import { Errors } from "../lib/response";
import type { AppEnv } from "../env";

/**
 * Extracts the better-auth session from the `Authorization: Bearer <token>`
 * header (bearer plugin) and stores `userId` + `session` on context
 * variables for downstream handlers. Rejects with 401 if absent/invalid.
 */
export async function requireAuth(c: Context<AppEnv>, next: Next) {
	const auth = createAuth(c.env);

	// WebSocket handshakes cannot set custom headers from mobile/web clients,
	// so /render-jobs/:id/ws passes the bearer token as `?token=`. Synthesize
	// the Authorization header for better-auth in that case.
	let headers = c.req.raw.headers;
	if (!headers.get("authorization")) {
		const queryToken = c.req.query("token");
		if (queryToken) {
			headers = new Headers(headers);
			headers.set("authorization", `Bearer ${queryToken}`);
		}
	}

	const session = await auth.api.getSession({ headers });

	if (!session?.user?.id) {
		return Errors.unauthorized(c);
	}

	c.set("userId", session.user.id);
	c.set("session", {
		id: session.session.id,
		userId: session.user.id,
		token: session.session.token,
	});
	await next();
}

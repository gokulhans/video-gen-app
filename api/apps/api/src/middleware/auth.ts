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

	const session = await auth.api.getSession({ headers: c.req.raw.headers });

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

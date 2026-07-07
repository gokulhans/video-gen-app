import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer } from "better-auth/plugins";
import { getDb, schema } from "@app/db";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { Env } from "../env";

/**
 * better-auth needs bindings that only exist per-request in Workers, so we
 * build a fresh instance per-request (cheap: no I/O happens at construction
 * time). Cache on the request-scoped `env` object isn't safe across
 * isolates, so we just construct it every time it's needed.
 */
export function createAuth(env: Env) {
	const db = getDb(env.DB);

	return betterAuth({
		baseURL: env.APP_BASE_URL,
		secret: env.BETTER_AUTH_SECRET,
		basePath: "/api/auth",
		database: drizzleAdapter(db, {
			provider: "sqlite",
			schema,
		}),
		// KV as secondary storage for sessions (fast reads, avoids D1 round trip).
		secondaryStorage: {
			get: async (key) => (await env.KV.get(key)) ?? null,
			set: async (key, value, ttl) => {
				await env.KV.put(key, value, ttl ? { expirationTtl: ttl } : undefined);
			},
			delete: async (key) => {
				await env.KV.delete(key);
			},
		},
		emailAndPassword: {
			enabled: true,
			requireEmailVerification: false,
		},
		socialProviders: {
			google: {
				clientId: env.GOOGLE_CLIENT_ID,
				clientSecret: env.GOOGLE_CLIENT_SECRET,
			},
		},
		// Bearer plugin lets mobile clients send `Authorization: Bearer <token>`
		// instead of cookies.
		plugins: [bearer()],
		databaseHooks: {
			user: {
				create: {
					after: async (user) => {
						await grantSignupBonus(env, user.id);
					},
				},
			},
		},
	});
}

/**
 * Signup bonus: read the singleton `settings` row and, if enabled, credit
 * the new user's token balance + write a token_transactions row. Uses
 * db.batch so both writes are atomic (best-effort — the user row was
 * already created by better-auth's own insert before this hook fires).
 */
async function grantSignupBonus(env: Env, userId: string) {
	const db = getDb(env.DB);

	const settingsRow = await db
		.select()
		.from(schema.settings)
		.limit(1)
		.get();

	const enabled = settingsRow?.enableSignupBonus ?? true;
	const bonus = settingsRow?.defaultSignupBonus ?? 600;
	if (!enabled || bonus <= 0) return;

	await db.batch([
		db
			.update(schema.user)
			.set({ tokens: bonus, updatedAt: new Date() })
			.where(eq(schema.user.id, userId)),
		db.insert(schema.tokenTransactions).values({
			id: nanoid(),
			userId,
			amount: bonus,
			type: "signup_bonus",
			description: "Welcome bonus",
		}),
	]);
}

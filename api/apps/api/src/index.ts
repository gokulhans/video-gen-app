import { Hono } from "hono";
import { cors } from "hono/cors";
import type { AppEnv } from "./env";
import { createAuth } from "./lib/auth";
import { requireAuth } from "./middleware/auth";
import { Errors } from "./lib/response";
import {
	ensureUploadReady,
	isPrivateUploadAssetKey,
	isGenerationMasterAssetKey,
	isSafeAssetKey,
	loadUploadByFetchToken,
	verifyGenerationMasterIngestToken,
} from "./lib/media";

import { projects } from "./routes/projects";
import { render } from "./routes/render";
import { tokens } from "./routes/tokens";
import { templates } from "./routes/templates";
import { brands } from "./routes/brands";
import { notifications } from "./routes/notifications";
import { devices } from "./routes/devices";
import { assets } from "./routes/assets";
import { voices } from "./routes/voices";
import { catalog } from "./routes/catalog";
import { generation } from "./routes/generation";
import { preferences } from "./routes/preferences";
import { accountLifecycle } from "./routes/account";
import { characters } from "./routes/characters";
import { sweepStaleCharacterUploads } from "./services/character-upload-cleanup";
import { sweepAssetCleanupOutbox } from "./services/asset-cleanup-outbox";
import { openApiDocument } from "@app/shared/openapi";
import { reconcileExpiredCreditReservations } from "./services/credit-reconciliation";

const app = new Hono<AppEnv>();

// Public, versioned contract for mobile/admin clients and CI compatibility
// checks. It is assembled from the shared Zod schemas at module load and does
// not expose provider-native payloads or secrets.
app.get("/openapi.json", (c) => c.json(openApiDocument));

app.use("*", async (c, next) => {
	const requestId = c.req.header("cf-ray") ?? crypto.randomUUID();
	c.set("requestId", requestId);
	c.header("x-request-id", requestId);
	await next();
});

app.use(
	"*",
	cors({
		origin: (origin, c) => {
			if (!origin) return "";
			const allowed = new Set(
				(c.env.ALLOWED_ORIGINS ?? "")
					.split(",")
					.map((value: string) => value.trim())
					.filter(Boolean),
			);
			return allowed.has(origin) ? origin : "";
		},
		credentials: true,
		allowHeaders: ["Content-Type", "Authorization", "Idempotency-Key"],
		exposeHeaders: ["x-request-id"],
	}),
);

function objectHeaders(object: R2Object, rangeRequested: boolean): Headers {
	const headers = new Headers({
		"accept-ranges": "bytes",
		"cache-control": "private, no-store",
		"content-length": String(object.size),
		"x-content-type-options": "nosniff",
		etag: object.httpEtag,
	});
	object.writeHttpMetadata(headers);
	const offset = object.range && "offset" in object.range ? object.range.offset : undefined;
	const length = object.range && "length" in object.range ? object.range.length : undefined;
	if (rangeRequested && offset !== undefined && length !== undefined) {
		headers.set("content-length", String(length));
		headers.set("content-range", `bytes ${offset}-${offset + length - 1}/${object.size}`);
	}
	return headers;
}

// Provider ingestion uses a high-entropy, expiring token. The token maps to
// one registered UPLOADS_BUCKET object; callers cannot supply bucket keys or
// arbitrary URLs. GET/HEAD and Range are supported for provider compatibility.
app.on(["GET", "HEAD"], "/media/input/:token", async (c) => {
	const record = await loadUploadByFetchToken(c.env, c.req.param("token"));
	if (!record) return Errors.notFound(c, "Media not found");
	try { await ensureUploadReady(c.env, record); }
	catch { return Errors.notFound(c, "Media not found"); }
	if (c.req.method === "HEAD") {
		const object = await c.env.UPLOADS_BUCKET.head(record.objectKey);
		if (!object) return Errors.notFound(c, "Media not found");
		return new Response(null, { headers: objectHeaders(object, false) });
	}
	const rangeRequested = c.req.header("range") !== undefined;
	let object: R2ObjectBody | null;
	try {
		object = await c.env.UPLOADS_BUCKET.get(record.objectKey, rangeRequested ? { range: c.req.raw.headers } : undefined);
	} catch {
		return new Response(null, { status: 416, headers: { "content-range": "bytes */*" } });
	}
	if (!object) return Errors.notFound(c, "Media not found");
	return new Response(object.body, { status: rangeRequested ? 206 : 200, headers: objectHeaders(object, rangeRequested) });
});

// One expiring, path-bound URL lets Stream ingest a private generation master.
// The R2 object key cannot be supplied independently of the HMAC token.
app.on(["GET", "HEAD"], "/media/generation/:token", async (c) => {
	const objectKey = await verifyGenerationMasterIngestToken(
		c.env.MEDIA_INGEST_SIGNING_SECRET,
		c.req.param("token"),
	);
	if (!objectKey) return Errors.notFound(c, "Media not found");
	if (c.req.method === "HEAD") {
		const object = await c.env.ASSETS_BUCKET.head(objectKey);
		return object ? new Response(null, { headers: objectHeaders(object, false) }) : Errors.notFound(c, "Media not found");
	}
	const rangeRequested = c.req.header("range") !== undefined;
	let object: R2ObjectBody | null;
	try {
		object = await c.env.ASSETS_BUCKET.get(objectKey, rangeRequested ? { range: c.req.raw.headers } : undefined);
	} catch {
		return new Response(null, { status: 416, headers: { "content-range": "bytes */*" } });
	}
	if (!object) return Errors.notFound(c, "Media not found");
	return new Response(object.body, { status: rangeRequested ? 206 : 200, headers: objectHeaders(object, rangeRequested) });
});

// Legacy generated assets remain publicly and immutably addressable for
// render/provider integrations. Explicit upload namespaces are denied even
// if an old client accidentally wrote one into ASSETS_BUCKET.
app.on(["GET", "HEAD"], "/assets/*", async (c) => {
	let key: string;
	try {
		key = decodeURIComponent(new URL(c.req.url).pathname.slice("/assets/".length));
	} catch {
		return Errors.badRequest(c, "Invalid asset key");
	}
	if (!isSafeAssetKey(key)) {
		return Errors.badRequest(c, "Invalid asset key");
	}
	if (isPrivateUploadAssetKey(key)) return Errors.notFound(c, "Asset not found");
	if (isGenerationMasterAssetKey(key)) return Errors.notFound(c, "Asset not found");
	if (c.req.method === "HEAD") {
		const object = await c.env.ASSETS_BUCKET.head(key);
		if (!object) return Errors.notFound(c, "Asset not found");
		const headers = objectHeaders(object, false);
		headers.set("cache-control", "public, max-age=31536000, immutable");
		return new Response(null, { headers });
	}
	const rangeRequested = c.req.header("range") !== undefined;
	const object = await c.env.ASSETS_BUCKET.get(key, rangeRequested ? { range: c.req.raw.headers } : undefined);
	if (!object) return Errors.notFound(c, "Asset not found");
	const headers = objectHeaders(object, rangeRequested);
	headers.set("cache-control", "public, max-age=31536000, immutable");
	return new Response(object.body, { status: rangeRequested ? 206 : 200, headers });
});

// ---------- better-auth handler ----------
// Mounted before the /api/v1 auth gate — better-auth manages its own routes
// (signup, login, OAuth callbacks, session refresh, etc).
app.on(["GET", "POST"], "/api/auth/*", (c) => {
	const auth = createAuth(c.env);
	return auth.handler(c.req.raw);
});

// ---------- /api/v1/* (Bearer session required) ----------
const v1 = new Hono<AppEnv>();
v1.use("*", requireAuth);

v1.route("/projects", projects);
v1.route("/", render); // owns /projects/:id/render, /render-jobs/:id, /render-jobs/:id/ws
v1.route("/tokens", tokens);
v1.route("/templates", templates);
v1.route("/brands", brands);
v1.route("/notifications", notifications);
v1.route("/devices", devices);
v1.route("/assets", assets);
v1.route("/voices", voices);
v1.route("/catalog", catalog);
v1.route("/generation", generation);
v1.route("/preferences", preferences);
v1.route("/account", accountLifecycle);
v1.route("/characters", characters);

app.route("/api/v1", v1);

app.get("/health", (c) => c.json({ ok: true }));

app.notFound((c) => Errors.notFound(c, "Route not found"));

app.onError((e, c) => {
	console.error(JSON.stringify({
		event: "unhandled_api_error",
		requestId: c.res.headers.get("x-request-id"),
		method: c.req.method,
		path: c.req.path,
		error: e instanceof Error ? e.message : String(e),
	}));
	return Errors.internal(c, "Internal server error");
});

export { app };
export default {
	fetch: app.fetch,
	scheduled(_controller: ScheduledController, env: AppEnv["Bindings"], ctx: ExecutionContext) {
		ctx.waitUntil(Promise.all([
			sweepStaleCharacterUploads(env),
			sweepAssetCleanupOutbox(env),
			reconcileExpiredCreditReservations(env.DB).then((result) => console.log(JSON.stringify({ event: "credit_reservation_reconciliation", ...result }))),
		]));
	},
};

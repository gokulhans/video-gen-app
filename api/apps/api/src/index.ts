import { Hono } from "hono";
import { cors } from "hono/cors";
import type { AppEnv } from "./env";
import { createAuth } from "./lib/auth";
import { requireAuth } from "./middleware/auth";
import { Errors } from "./lib/response";

import { projects } from "./routes/projects";
import { render } from "./routes/render";
import { tokens } from "./routes/tokens";
import { templates } from "./routes/templates";
import { brands } from "./routes/brands";
import { notifications } from "./routes/notifications";
import { devices } from "./routes/devices";
import { assets } from "./routes/assets";
import { voices } from "./routes/voices";

const app = new Hono<AppEnv>();

app.use("*", async (c, next) => {
	const requestId = c.req.header("cf-ray") ?? crypto.randomUUID();
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

// Generated pipeline assets are intentionally public-by-unguessable-key so
// Remotion, media players, and external AI providers can fetch them. User
// uploads remain private in UPLOADS_BUCKET and are only exposed by presigned
// URLs from the authenticated /api/v1/assets routes.
app.get("/assets/*", async (c) => {
	let key: string;
	try {
		key = decodeURIComponent(new URL(c.req.url).pathname.slice("/assets/".length));
	} catch {
		return Errors.badRequest(c, "Invalid asset key");
	}
	if (!key || key.length > 1_024 || key.startsWith("/") || key.split("/").some((part) => !part || part === "." || part === "..")) {
		return Errors.badRequest(c, "Invalid asset key");
	}
	const object = await c.env.ASSETS_BUCKET.get(key);
	if (!object) return Errors.notFound(c, "Asset not found");
	const headers = new Headers({
		"cache-control": "public, max-age=31536000, immutable",
		"x-content-type-options": "nosniff",
		etag: object.httpEtag,
	});
	object.writeHttpMetadata(headers);
	return new Response(object.body, { headers });
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

export default app;

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

app.use(
	"*",
	cors({
		origin: (origin) => origin ?? "*",
		credentials: true,
		allowHeaders: ["Content-Type", "Authorization"],
	}),
);

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
	console.error("Unhandled error", e);
	return Errors.internal(c, e instanceof Error ? e.message : "Internal error");
});

export default app;

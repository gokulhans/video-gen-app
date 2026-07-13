import { Hono } from "hono";
import { err } from "@app/shared";
import type { AppBindings } from "./types.js";
import { requireAdmin } from "./middleware/auth.js";

import configRoute from "./routes/config.js";
import statsRoute from "./routes/stats.js";
import usersRoute from "./routes/users.js";
import transactionsRoute from "./routes/transactions.js";
import tokenCostsRoute from "./routes/token-costs.js";
import settingsRoute from "./routes/settings.js";
import renderJobsRoute from "./routes/render-jobs.js";
import templatesRoute from "./routes/templates.js";
import categoriesRoute from "./routes/categories.js";
import providersRoute from "./routes/providers.js";
import pricingRoute from "./routes/pricing.js";
import voicesRoute from "./routes/voices.js";
import charactersRoute from "./routes/characters.js";
import generationJobsRoute from "./routes/generation-jobs.js";
import auditRoute from "./routes/audit.js";
import { can } from "./lib/permissions.js";

const app = new Hono<AppBindings>();

app.use("*", async (c, next) => {
	const requestId = c.req.header("cf-ray") ?? c.req.header("x-request-id") ?? crypto.randomUUID();
	c.set("requestId", requestId);
	await next();
	const authOrigin = c.env.AUTH_API_URL ? new URL(c.env.AUTH_API_URL).origin : "";
	c.header("x-request-id", requestId);
	c.header("content-security-policy", `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' https: ${authOrigin}; frame-ancestors 'none'; base-uri 'self'; object-src 'none'`);
	c.header("x-content-type-options", "nosniff");
	c.header("referrer-policy", "no-referrer");
	c.header("permissions-policy", "camera=(), microphone=(), geolocation=()");
});

// Public — bootstraps the login screen with the main api's auth URL.
app.route("/api/admin/config", configRoute);

// Every other /api/admin/* route requires a valid admin bearer session.
app.use("/api/admin/*", async (c, next) => {
	if (c.req.path === "/api/admin/config") return next();
	return requireAdmin(c, next);
});

app.get("/api/admin/me", (c) => c.json({ data: c.get("adminUser") }));

// Compatibility routes predate fine-grained RBAC. Keep them available while
// enforcing an explicit legacy read/write capability for role-based admins.
app.use("/api/admin/*", async (c, next) => {
	const segment = c.req.path.split("/")[3] ?? "";
	const legacy = new Set(["stats", "users", "transactions", "token-costs", "settings", "render-jobs"]);
	if (!legacy.has(segment)) return next();
	const permission = c.req.method === "GET" ? "legacy.read" : "legacy.write";
	if (!can(c.get("adminUser"), permission)) return c.json(err("FORBIDDEN", `Permission required: ${permission}`), 403);
	return next();
});

app.route("/api/admin/stats", statsRoute);
app.route("/api/admin/users", usersRoute);
app.route("/api/admin/transactions", transactionsRoute);
app.route("/api/admin/token-costs", tokenCostsRoute);
app.route("/api/admin/settings", settingsRoute);
app.route("/api/admin/render-jobs", renderJobsRoute);
app.route("/api/admin/templates", templatesRoute);
app.route("/api/admin/categories", categoriesRoute);
app.route("/api/admin/providers", providersRoute);
app.route("/api/admin/pricing", pricingRoute);
app.route("/api/admin/voices", voicesRoute);
app.route("/api/admin/characters", charactersRoute);
app.route("/api/admin/generation-jobs", generationJobsRoute);
app.route("/api/admin/audit", auditRoute);

app.notFound((c) => c.json(err("NOT_FOUND", "Not found"), 404));

app.onError((e, c) => {
	console.error(JSON.stringify({ message: "admin request failed", requestId: c.get("requestId"), path: c.req.path, method: c.req.method, error: e instanceof Error ? e.message : String(e) }));
	return c.json(err("INTERNAL_ERROR", "Internal server error"), 500);
});

export default app;

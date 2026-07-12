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

const app = new Hono<AppBindings>();

app.use("*", async (c, next) => {
	await next();
	c.header("content-security-policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https:; frame-ancestors 'none'; base-uri 'self'; object-src 'none'");
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

app.route("/api/admin/stats", statsRoute);
app.route("/api/admin/users", usersRoute);
app.route("/api/admin/transactions", transactionsRoute);
app.route("/api/admin/token-costs", tokenCostsRoute);
app.route("/api/admin/settings", settingsRoute);
app.route("/api/admin/render-jobs", renderJobsRoute);
app.route("/api/admin/templates", templatesRoute);

app.notFound((c) => c.json(err("NOT_FOUND", "Not found"), 404));

app.onError((e, c) => {
	console.error(e);
	return c.json(err("INTERNAL_ERROR", "Internal server error"), 500);
});

export default app;

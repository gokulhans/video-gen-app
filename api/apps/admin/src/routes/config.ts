import { Hono } from "hono";
import { ok } from "@app/shared";
import type { AppBindings } from "../types.js";

// Public, unauthenticated endpoint — bootstraps the login screen with the
// main api's better-auth base URL so the dashboard can sign users in.
const app = new Hono<AppBindings>();

app.get("/", (c) => {
	return c.json(
		ok({
			authApiUrl: c.env.AUTH_API_URL ?? "",
		})
	);
});

export default app;

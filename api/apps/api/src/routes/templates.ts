import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@app/db";
import type { AppEnv } from "../env";
import { okJson } from "../lib/response";

export const templates = new Hono<AppEnv>();

const KV_KEY = "templates:v1";
const KV_TTL_SECONDS = 3600;

// ---------- GET /templates ----------
templates.get("/", async (c) => {
	const cached = await c.env.KV.get(KV_KEY, "json");
	if (cached) {
		return okJson(c, cached);
	}

	const db = getDb(c.env.DB);
	const rows = await db.select().from(schema.templates).where(eq(schema.templates.isActive, true));

	// Write-through so the next request is a KV hit.
	await c.env.KV.put(KV_KEY, JSON.stringify(rows), { expirationTtl: KV_TTL_SECONDS });

	return okJson(c, rows);
});

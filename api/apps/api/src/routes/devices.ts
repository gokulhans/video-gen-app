import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb, schema } from "@app/db";
import type { AppEnv } from "../env";
import { okJson } from "../lib/response";

export const devices = new Hono<AppEnv>();

const RegisterBody = z.object({
	fcmToken: z.string().min(1),
	platform: z.enum(["android", "ios"]),
});

// ---------- POST /register (upsert by fcmToken) ----------
devices.post("/register", zValidator("json", RegisterBody), async (c) => {
	const userId = c.get("userId");
	const { fcmToken, platform } = c.req.valid("json");
	const db = getDb(c.env.DB);

	const existing = await db
		.select()
		.from(schema.devices)
		.where(eq(schema.devices.fcmToken, fcmToken))
		.get();

	const now = Date.now();
	if (existing) {
		await db
			.update(schema.devices)
			.set({ userId, platform, lastSeenAt: now })
			.where(eq(schema.devices.fcmToken, fcmToken));
		return okJson(c, { id: existing.id, updated: true });
	}

	const id = nanoid();
	await db.insert(schema.devices).values({
		id,
		userId,
		fcmToken,
		platform,
		lastSeenAt: now,
		createdAt: now,
	});
	return okJson(c, { id, updated: false }, 201);
});

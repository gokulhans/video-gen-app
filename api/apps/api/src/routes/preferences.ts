import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@app/db";
import type { AppEnv } from "../env";
import { okJson } from "../lib/response";

export const preferences = new Hono<AppEnv>();
const Defaults={ pushEnabled:true,emailEnabled:false,generationUpdates:true,renderUpdates:true,productUpdates:false } as const;
const NotificationPreferences=z.object({
	pushEnabled:z.boolean(),emailEnabled:z.boolean(),generationUpdates:z.boolean(),renderUpdates:z.boolean(),productUpdates:z.boolean(),
}).strict();

preferences.get("/notifications",async(c)=>{
	const row=await getDb(c.env.DB).select().from(schema.notificationPreferences).where(eq(schema.notificationPreferences.userId,c.get("userId"))).get();
	return okJson(c,row ? { ...Defaults,...row } : Defaults);
});

preferences.put("/notifications",zValidator("json",NotificationPreferences),async(c)=>{
	const value=c.req.valid("json"); const now=Date.now();
	await c.env.DB.prepare(`INSERT INTO notification_preferences (user_id,push_enabled,email_enabled,generation_updates,render_updates,product_updates,updated_at)
		VALUES (?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET push_enabled=excluded.push_enabled,email_enabled=excluded.email_enabled,generation_updates=excluded.generation_updates,render_updates=excluded.render_updates,product_updates=excluded.product_updates,updated_at=excluded.updated_at`)
		.bind(c.get("userId"),value.pushEnabled,value.emailEnabled,value.generationUpdates,value.renderUpdates,value.productUpdates,now).run();
	return okJson(c,{...value,updatedAt:now});
});

preferences.get("/consent-summary",async(c)=>{
	const row=await getDb(c.env.DB).select({ characterConsents:sql<number>`count(*)` }).from(schema.userCharacterVersions)
		.where(eq(schema.userCharacterVersions.userId,c.get("userId"))).get();
	return okJson(c,{
		termsAccepted:true,
		privacyPolicyAccepted:true,
		marketingConsent:false,
		characterConsentRecords:Number(row?.characterConsents ?? 0),
		note:"Character consent records are immutable per version. Marketing consent is opt-in.",
	});
});

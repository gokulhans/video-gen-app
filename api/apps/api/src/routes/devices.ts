import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getDb, schema } from "@app/db";
import type { AppEnv } from "../env";
import { Errors, okJson } from "../lib/response";

export const devices = new Hono<AppEnv>();
const RegisterBody=z.object({ fcmToken:z.string().trim().min(16).max(4096),platform:z.enum(["android","ios"]) }).strict();
const UnregisterBody=z.object({ fcmToken:z.string().trim().min(16).max(4096) }).strict();

devices.post("/register",zValidator("json",RegisterBody),async(c)=>{
	const {fcmToken,platform}=c.req.valid("json"); const now=Date.now(); const db=getDb(c.env.DB);
	const existing=await db.select().from(schema.devices).where(eq(schema.devices.fcmToken,fcmToken)).get();
	if(existing){ await db.update(schema.devices).set({userId:c.get("userId"),platform,lastSeenAt:now,updatedAt:now,disabledAt:null}).where(eq(schema.devices.id,existing.id)); return okJson(c,{id:existing.id,updated:true}); }
	const id=nanoid(); await db.insert(schema.devices).values({id,userId:c.get("userId"),fcmToken,platform,lastSeenAt:now,createdAt:now,updatedAt:now});
	return okJson(c,{id,updated:false},201);
});

devices.post("/unregister",zValidator("json",UnregisterBody),async(c)=>{
	const result=await c.env.DB.prepare("DELETE FROM devices WHERE user_id=? AND fcm_token=?")
		.bind(c.get("userId"),c.req.valid("json").fcmToken).run();
	return okJson(c,{removed:(result.meta.changes ?? 0)>0});
});

devices.delete("/:id",async(c)=>{
	const row=await getDb(c.env.DB).select({id:schema.devices.id}).from(schema.devices).where(and(eq(schema.devices.id,c.req.param("id")),eq(schema.devices.userId,c.get("userId")))).get();
	if(!row)return Errors.notFound(c,"Device not found");
	await getDb(c.env.DB).delete(schema.devices).where(and(eq(schema.devices.id,row.id),eq(schema.devices.userId,c.get("userId"))));
	return okJson(c,{id:row.id,removed:true});
});

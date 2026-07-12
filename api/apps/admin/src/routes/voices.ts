import { Hono } from "hono";
import { z } from "zod";
import { nanoid } from "nanoid";
import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "@app/db";
import { err, ok } from "@app/shared";
import type { AppBindings } from "../types.js";
import { isResponse, parseBody, requirePermission } from "../lib/http.js";
import { writeAudit } from "../lib/audit.js";

const app = new Hono<AppBindings>();
const voiceSchema = z.object({ slug: z.string().trim().min(2).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/), name: z.string().trim().min(1).max(120), locale: z.string().trim().min(2).max(20), style: z.string().trim().max(120).nullable().optional(), sampleAssetKey: z.string().trim().max(500).nullable().optional(), tags: z.array(z.string().trim().min(1).max(40)).max(30).default([]), isPremium: z.boolean().default(false), isActive: z.boolean().default(true), sortOrder: z.number().int().min(0).max(10000).default(0), reason: z.string().trim().min(3).max(500) }).strict();
const updateSchema = voiceSchema.omit({ slug: true }).partial().required({ reason: true }).strict();

app.get("/", async (c) => { const denied = requirePermission(c, "voices.read"); if (denied) return denied; return c.json(ok(await getDb(c.env.DB).select().from(schema.voices).orderBy(asc(schema.voices.sortOrder), asc(schema.voices.name)))); });
app.post("/", async (c) => { const denied = requirePermission(c, "voices.write"); if (denied) return denied; const body = await parseBody(c, voiceSchema); if (isResponse(body)) return body; const { reason, ...values } = body; const id = nanoid(); await getDb(c.env.DB).insert(schema.voices).values({ id, ...values }); await c.env.KV.delete("catalog:version"); await writeAudit(c, { action: "voice.create", targetType: "voice", targetId: id, reason, after: values }); return c.json(ok({ id }), 201); });
app.put("/:id", async (c) => { const denied = requirePermission(c, "voices.write"); if (denied) return denied; const body = await parseBody(c, updateSchema); if (isResponse(body)) return body; const db = getDb(c.env.DB); const id = c.req.param("id"); const [before] = await db.select().from(schema.voices).where(eq(schema.voices.id, id)).limit(1); if (!before) return c.json(err("NOT_FOUND", "Voice not found"), 404); const { reason, ...values } = body; await db.update(schema.voices).set({ ...values, updatedAt: Date.now() }).where(eq(schema.voices.id, id)); await c.env.KV.delete("catalog:version"); await writeAudit(c, { action: "voice.update", targetType: "voice", targetId: id, reason, before, after: values }); return c.json(ok({ id })); });
export default app;

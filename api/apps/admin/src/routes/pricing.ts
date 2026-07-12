import { Hono } from "hono";
import { z } from "zod";
import { nanoid } from "nanoid";
import { and, desc, eq, max } from "drizzle-orm";
import { getDb, schema } from "@app/db";
import { err, ok } from "@app/shared";
import type { AppBindings } from "../types.js";
import { isResponse, parseBody, requirePermission } from "../lib/http.js";
import { writeAudit } from "../lib/audit.js";

const app = new Hono<AppBindings>();
const draftSchema = z.object({ priceKey: z.string().trim().min(2).max(100).regex(/^[a-z0-9_.-]+$/), creditAmount: z.number().int().min(0).max(1_000_000), currency: z.string().trim().length(3).default("USD"), estimatedCostMicros: z.number().int().min(0).max(1_000_000_000).default(0), reason: z.string().trim().min(3).max(500) }).strict();
const reasonSchema = z.object({ reason: z.string().trim().min(3).max(500) }).strict();

app.get("/", async (c) => {
	const denied = requirePermission(c, "pricing.read"); if (denied) return denied;
	return c.json(ok(await getDb(c.env.DB).select().from(schema.pricingVersions).orderBy(desc(schema.pricingVersions.createdAt))));
});

app.post("/", async (c) => {
	const denied = requirePermission(c, "pricing.write"); if (denied) return denied;
	const body = await parseBody(c, draftSchema); if (isResponse(body)) return body;
	const db = getDb(c.env.DB); const [latest] = await db.select({ value: max(schema.pricingVersions.version) }).from(schema.pricingVersions).where(eq(schema.pricingVersions.priceKey, body.priceKey));
	const id = nanoid(); const { reason, ...values } = body; const version = (latest?.value ?? 0) + 1;
	await db.insert(schema.pricingVersions).values({ id, version, status: "draft", ...values });
	await writeAudit(c, { action: "pricing.draft.create", targetType: "pricing_version", targetId: id, reason, after: { ...values, version } });
	return c.json(ok({ id, version }), 201);
});

app.post("/:id/publish", async (c) => {
	const denied = requirePermission(c, "pricing.publish"); if (denied) return denied;
	const body = await parseBody(c, reasonSchema); if (isResponse(body)) return body;
	const db = getDb(c.env.DB); const id = c.req.param("id"); const [row] = await db.select().from(schema.pricingVersions).where(eq(schema.pricingVersions.id, id)).limit(1);
	if (!row) return c.json(err("NOT_FOUND", "Pricing version not found"), 404);
	if (row.status !== "draft") return c.json(err("INVALID_STATUS", "Only draft pricing can be published"), 409);
	await db.update(schema.pricingVersions).set({ status: "published", publishedAt: Date.now() }).where(and(eq(schema.pricingVersions.id, id), eq(schema.pricingVersions.status, "draft")));
	await c.env.KV.delete("catalog:version");
	await writeAudit(c, { action: "pricing.publish", targetType: "pricing_version", targetId: id, reason: body.reason, before: row, after: { status: "published" } });
	return c.json(ok({ id, status: "published" }));
});

export default app;

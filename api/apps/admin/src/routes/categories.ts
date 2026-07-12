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
const slug = z.string().trim().min(2).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const createSchema = z.object({ slug, name: z.string().trim().min(1).max(120), description: z.string().trim().max(500).nullable().optional(), coverAssetKey: z.string().trim().max(500).nullable().optional(), sortOrder: z.number().int().min(-10000).max(10000).default(0), isActive: z.boolean().default(true), reason: z.string().trim().min(3).max(500) }).strict();
const updateSchema = createSchema.partial().required({ reason: true }).strict();

app.get("/", async (c) => {
	const denied = requirePermission(c, "catalog.read"); if (denied) return denied;
	const rows = await getDb(c.env.DB).select().from(schema.categories).orderBy(asc(schema.categories.sortOrder), asc(schema.categories.name));
	return c.json(ok(rows));
});

app.post("/", async (c) => {
	const denied = requirePermission(c, "catalog.write"); if (denied) return denied;
	const body = await parseBody(c, createSchema); if (isResponse(body)) return body;
	const { reason, ...values } = body; const id = nanoid(); const db = getDb(c.env.DB);
	await db.insert(schema.categories).values({ id, ...values });
	await c.env.KV.delete("catalog:version");
	await writeAudit(c, { action: "category.create", targetType: "category", targetId: id, reason, after: values });
	return c.json(ok({ id, ...values }), 201);
});

app.put("/:id", async (c) => {
	const denied = requirePermission(c, "catalog.write"); if (denied) return denied;
	const body = await parseBody(c, updateSchema); if (isResponse(body)) return body;
	const db = getDb(c.env.DB); const id = c.req.param("id");
	const [before] = await db.select().from(schema.categories).where(eq(schema.categories.id, id)).limit(1);
	if (!before) return c.json(err("NOT_FOUND", "Category not found"), 404);
	const { reason, ...changes } = body; await db.update(schema.categories).set({ ...changes, updatedAt: Date.now() }).where(eq(schema.categories.id, id));
	await c.env.KV.delete("catalog:version");
	await writeAudit(c, { action: "category.update", targetType: "category", targetId: id, reason, before, after: changes });
	return c.json(ok({ id }));
});

export default app;

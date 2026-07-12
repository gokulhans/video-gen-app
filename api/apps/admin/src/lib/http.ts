import { z } from "zod";
import type { Context } from "hono";
import { err } from "@app/shared";
import type { AppBindings } from "../types.js";
import type { AdminPermission } from "./permissions.js";
import { can } from "./permissions.js";

export async function parseBody<T extends z.ZodType>(c: Context<AppBindings>, schema: T): Promise<z.output<T> | Response> {
	const value = await c.req.json().catch(() => undefined);
	const parsed = schema.safeParse(value);
	if (!parsed.success) {
		return c.json(err("VALIDATION_ERROR", parsed.error.issues.map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`).join("; ")), 400);
	}
	return parsed.data;
}

export function requirePermission(c: Context<AppBindings>, permission: AdminPermission): Response | undefined {
	if (can(c.get("adminUser"), permission)) return undefined;
	return c.json(err("FORBIDDEN", `Permission required: ${permission}`), 403);
}

export function isResponse(value: unknown): value is Response {
	return value instanceof Response;
}

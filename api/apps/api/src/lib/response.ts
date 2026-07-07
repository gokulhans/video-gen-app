import type { Context } from "hono";
import { ok, err } from "@app/shared";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/** 200 OK envelope: `{ data }` */
export function okJson<T>(c: Context, data: T, status: ContentfulStatusCode = 200) {
	return c.json(ok(data), status);
}

/** Error envelope: `{ error: { code, message } }` with proper HTTP status. */
export function errJson(c: Context, status: ContentfulStatusCode, code: string, message: string) {
	return c.json(err(code, message), status);
}

export const Errors = {
	unauthorized: (c: Context, message = "Authentication required") =>
		errJson(c, 401, "unauthorized", message),
	forbidden: (c: Context, message = "Forbidden") => errJson(c, 403, "forbidden", message),
	notFound: (c: Context, message = "Not found") => errJson(c, 404, "not_found", message),
	badRequest: (c: Context, message = "Invalid request") =>
		errJson(c, 400, "bad_request", message),
	validation: (c: Context, message: string) => errJson(c, 422, "validation_error", message),
	insufficientTokens: (c: Context, message = "Insufficient token balance") =>
		errJson(c, 402, "insufficient_tokens", message),
	rateLimited: (c: Context, message = "Too many requests") =>
		errJson(c, 429, "rate_limited", message),
	internal: (c: Context, message = "Internal error") => errJson(c, 500, "internal_error", message),
};

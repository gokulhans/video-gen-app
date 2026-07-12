import { Hono } from "hono";
import type { AppEnv } from "../env";
import { Errors, okJson } from "../lib/response";
import {
	cancelGenerationJob,
	createGenerationJob,
	createGenerationQuote,
	GenerationServiceError,
	getGenerationJob,
	listGenerationJobs,
} from "../services/generation";

export const generation = new Hono<AppEnv>();

function serviceError(c: Parameters<typeof Errors.badRequest>[0], error: unknown) {
	if (error instanceof SyntaxError) return Errors.validation(c, "Request body must be valid JSON");
	if (!(error instanceof GenerationServiceError)) throw error;
	switch (error.code) {
		case "not_found": return Errors.notFound(c, error.message);
		case "validation_error": return Errors.validation(c, error.message);
		case "conflict": return Errors.conflict(c, error.message);
		case "insufficient_tokens": return Errors.insufficientTokens(c, error.message);
		case "workflow_start_failed": return Errors.serviceUnavailable(c, error.message);
	}
}

generation.post("/quotes", async (c) => {
	try { return okJson(c, await createGenerationQuote(c.env, c.get("userId"), await c.req.json()), 201); }
	catch (error) { return serviceError(c, error); }
});

generation.post("/jobs", async (c) => {
	try {
		const idempotencyKey = c.req.header("idempotency-key");
		if (!idempotencyKey) return Errors.validation(c, "Idempotency-Key header is required");
		const result = await createGenerationJob(c.env, c.get("userId"), c.get("requestId"), await c.req.json(), idempotencyKey);
		return okJson(c, result, 202);
	} catch (error) { return serviceError(c, error); }
});

generation.get("/jobs", async (c) => {
	try { return okJson(c, await listGenerationJobs(c.env, c.get("userId"), c.req.query())); }
	catch (error) { return serviceError(c, error); }
});

generation.get("/jobs/:id", async (c) => {
	try { return okJson(c, await getGenerationJob(c.env, c.get("userId"), c.req.param("id"))); }
	catch (error) { return serviceError(c, error); }
});

generation.post("/jobs/:id/cancel", async (c) => {
	try { return okJson(c, await cancelGenerationJob(c.env, c.get("userId"), c.req.param("id")), 202); }
	catch (error) { return serviceError(c, error); }
});

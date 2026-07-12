import test from "node:test";
import assert from "node:assert/strict";
import { openApiDocument } from "@app/shared/openapi";

test("OpenAPI contract is versioned and provider-neutral", () => {
	assert.equal(openApiDocument.openapi, "3.1.0");
	assert.equal(openApiDocument.servers[0].url, "/api/v1");
	assert.ok(Object.hasOwn(openApiDocument.paths, "/generation/jobs"));
	assert.ok(Object.hasOwn(openApiDocument.paths, "/account/export-requests"));
	for (const path of [
		"/tokens/purchase/verify",
		"/assets/{assetId}/provider-url",
		"/voices/{voiceId}/favorite",
		"/notifications/{id}/read",
		"/brands/{id}/archive",
		"/characters/mine/{id}",
		"/account/deletion-requests/{id}/confirm",
		"/projects/{id}/script/rewrite",
		"/render-jobs/{id}/ws",
	]) assert.ok(Object.hasOwn(openApiDocument.paths, path), `missing OpenAPI path: ${path}`);
	assert.ok(Object.hasOwn(openApiDocument.components.schemas, "PurchaseVerifyRequest"));
	assert.equal(openApiDocument.paths["/tokens/purchase/verify"].post.requestBody.required, true);
	assert.ok(Object.hasOwn(openApiDocument.components.securitySchemes, "bearerAuth"));
	const serialized = JSON.stringify(openApiDocument);
	assert.equal(serialized.includes("REPLICATE_API_TOKEN"), false);
	assert.equal(serialized.includes("provider-native"), false);
});

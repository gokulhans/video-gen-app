/**
 * Public API contract generated from the same Zod schemas used by Workers.
 *
 * Keep this module dependency-free apart from Zod: API, Flutter tooling and
 * CI can import `openApiDocument` without depending on Hono or a Cloudflare
 * runtime. OpenAPI 3.1 uses JSON Schema 2020-12, which is emitted natively by
 * Zod 4. The provider-native Replicate payload is deliberately absent.
 */
import { z } from "zod";
import {
	CharacterSelection,
	CreateGenerationJobRequest,
	CreateGenerationJobResponse,
	GenerationJob,
	GenerationQuote,
	ListGenerationJobsQuery,
	ListGenerationJobsResponse,
	ProjectComposition,
	QuoteGenerationRequest,
	TemplateInputSchema,
} from "./index.js";

// Keep this alias local so adding a new contract does not require changing the
// document assembly code below.
const contractSchemas = {
	CharacterSelection,
	CreateGenerationJobRequest,
	CreateGenerationJobResponse,
	GenerationJob,
	GenerationQuote,
	ListGenerationJobsQuery,
	ListGenerationJobsResponse,
	ProjectComposition,
	QuoteGenerationRequest,
	TemplateInputSchema,
} as const;

// Small public request bodies that are intentionally kept here when a route
// does not yet have a reusable shared Zod contract. These still constrain the
// wire format for generated clients (and can later be promoted to index.ts).
const purchaseVerifyRequest = z.object({
	productId: z.string().trim().min(1).max(200),
	purchaseToken: z.string().min(20).max(8_000),
}).strict();

type JsonSchema = Record<string, unknown>;
type Operation = Record<string, unknown>;

function jsonSchema(schema: z.ZodType): JsonSchema {
	// Zod 4's converter emits standards-compliant JSON Schema and rejects
	// unsupported provider/runtime values instead of silently weakening them.
	return z.toJSONSchema(schema, { target: "draft-2020-12" }) as JsonSchema;
}

const schemaRefs = Object.fromEntries(
	Object.entries(contractSchemas).map(([name, schema]) => [name, jsonSchema(schema)]),
);

const jsonResponse = (description = "Successful response") => ({
		description,
		content: { "application/json": { schema: { $ref: "#/components/schemas/ApiOk" } } },
});

const requestBody = (name: keyof typeof contractSchemas, required = true) => ({
		required,
		content: { "application/json": { schema: { $ref: `#/components/schemas/${name}` } } },
});

const auth = [{ bearerAuth: [] }];
const operation = (summary: string, extra: Operation = {}): Operation => ({
		summary,
		tags: [summary.split(" ")[0]],
		security: auth,
		responses: { "200": jsonResponse(), "401": { $ref: "#/components/responses/Unauthorized" }, "422": { $ref: "#/components/responses/Validation" } },
		...extra,
});

/** OpenAPI 3.1 document for the versioned user API. */
export const openApiDocument = {
		openapi: "3.1.0",
		info: {
			title: "Aividgen AI Video API",
			version: "1.0.0",
			description: "Stable, tenant-scoped API contract. Provider payloads and secrets are never public.",
		},
		servers: [{ url: "/api/v1", description: "Cloudflare Worker API" }],
		security: auth,
		paths: {
			"/catalog/categories": { get: operation("List catalog categories") },
			"/catalog/templates": { get: operation("List published templates") },
			"/templates": { get: operation("List legacy templates") },
			"/generation/quotes": { post: operation("Quote generation", { requestBody: requestBody("QuoteGenerationRequest"), responses: { "201": jsonResponse("Quote created") } }) },
			"/generation/jobs": {
				get: operation("List generation jobs", { parameters: [{ $ref: "#/components/parameters/Cursor" }, { $ref: "#/components/parameters/Limit" }] }),
				post: operation("Create generation job", { parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }], requestBody: requestBody("CreateGenerationJobRequest"), responses: { "201": jsonResponse("Job created") } }),
			},
			"/generation/jobs/{id}": { get: operation("Get generation job", { parameters: [{ $ref: "#/components/parameters/JobId" }] }) },
			"/generation/jobs/{id}/cancel": { post: operation("Cancel generation job", { parameters: [{ $ref: "#/components/parameters/JobId" }], responses: { "202": jsonResponse("Cancellation accepted") } }) },
			"/projects": { get: operation("List projects"), post: operation("Create project") },
			"/projects/{id}": { get: operation("Get project", { parameters: [{ $ref: "#/components/parameters/ResourceId" }] }), delete: operation("Delete project", { parameters: [{ $ref: "#/components/parameters/ResourceId" }] }) },
			"/projects/{id}/composition": { patch: operation("Update project composition", { parameters: [{ $ref: "#/components/parameters/ResourceId" }], requestBody: requestBody("ProjectComposition") }) },
			"/projects/{id}/generate": { post: operation("Generate project", { parameters: [{ $ref: "#/components/parameters/ResourceId" }] }) },
			"/projects/{id}/generate/retry": { post: operation("Retry project generation", { parameters: [{ $ref: "#/components/parameters/ResourceId" }] }) },
			"/projects/{id}/generation-status": { get: operation("Get project generation status", { parameters: [{ $ref: "#/components/parameters/ResourceId" }] }) },
			"/projects/{id}/scenes/{sceneId}/regenerate-image": { post: operation("Regenerate scene image", { parameters: [{ $ref: "#/components/parameters/ResourceId" }, { $ref: "#/components/parameters/SceneId" }] }) },
			"/projects/{id}/voice/regenerate": { post: operation("Regenerate project voice", { parameters: [{ $ref: "#/components/parameters/ResourceId" }] }) },
			"/projects/{id}/script/rewrite": { post: operation("Rewrite project script", { parameters: [{ $ref: "#/components/parameters/ResourceId" }] }) },
			"/projects/{id}/render": { post: operation("Queue project render", { parameters: [{ $ref: "#/components/parameters/ResourceId" }, { $ref: "#/components/parameters/IdempotencyKey" }] }) },
			"/render-jobs/{id}": { get: operation("Get render job", { parameters: [{ $ref: "#/components/parameters/ResourceId" }] }) },
			"/render-jobs/{id}/ws": { get: operation("Open render progress WebSocket", { parameters: [{ $ref: "#/components/parameters/ResourceId" }] }) },
			"/brands": { get: operation("List brand kits"), post: operation("Create brand kit", { parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }] }) },
			"/brands/{id}": { get: operation("Get brand kit", { parameters: [{ $ref: "#/components/parameters/ResourceId" }] }), patch: operation("Update brand kit", { parameters: [{ $ref: "#/components/parameters/ResourceId" }, { $ref: "#/components/parameters/IdempotencyKey" }] }), delete: operation("Delete brand kit", { parameters: [{ $ref: "#/components/parameters/ResourceId" }] }) },
			"/brands/{id}/archive": { post: operation("Archive brand kit", { parameters: [{ $ref: "#/components/parameters/ResourceId" }] }) },
			"/characters/stock": { get: operation("List stock characters") },
			"/characters/mine": { get: operation("List user characters"), post: operation("Create user character", { parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }] }) },
			"/characters/mine/{id}": { delete: operation("Delete user character", { parameters: [{ $ref: "#/components/parameters/ResourceId" }] }) },
			"/characters/mine/{id}/archive": { patch: operation("Archive user character", { parameters: [{ $ref: "#/components/parameters/ResourceId" }] }) },
			"/voices": { get: operation("List voices") },
			"/voices/{voiceId}/favorite": { put: operation("Favorite voice", { parameters: [{ $ref: "#/components/parameters/VoiceId" }] }), delete: operation("Unfavorite voice", { parameters: [{ $ref: "#/components/parameters/VoiceId" }] }) },
			"/notifications": { get: operation("List notifications") },
			"/notifications/unread-count": { get: operation("Get unread notification count") },
			"/notifications/read-all": { post: operation("Mark all notifications read") },
			"/notifications/{id}/read": { post: operation("Mark notification read", { parameters: [{ $ref: "#/components/parameters/ResourceId" }] }) },
			"/preferences/notifications": { get: operation("Get notification preferences"), put: operation("Update notification preferences") },
			"/preferences/consent-summary": { get: operation("Get consent summary") },
			"/devices/register": { post: operation("Register push device") },
			"/devices/unregister": { post: operation("Unregister push device") },
			"/devices/{id}": { delete: operation("Delete push device", { parameters: [{ $ref: "#/components/parameters/ResourceId" }] }) },
			"/assets/upload-url": { post: operation("Create upload URL") },
			"/assets/upload-private-url": { post: operation("Create private upload URL") },
			"/assets/{assetId}/finalize": { post: operation("Finalize upload", { parameters: [{ $ref: "#/components/parameters/AssetId" }] }) },
			"/assets/{assetId}/provider-url": { post: operation("Create provider input URL", { parameters: [{ $ref: "#/components/parameters/AssetId" }] }) },
			"/assets/{assetId}": { delete: operation("Delete uploaded asset", { parameters: [{ $ref: "#/components/parameters/AssetId" }] }) },
			"/assets/download-url": { post: operation("Create asset download URL") },
			"/assets/generation/{assetId}": { get: operation("Get generation asset", { parameters: [{ $ref: "#/components/parameters/AssetId" }] }) },
			"/tokens/balance": { get: operation("Get token balance") },
			"/tokens/history": { get: operation("List token transactions") },
			"/tokens/cost-estimate": { get: operation("Estimate token cost") },
			"/tokens/purchase/verify": { post: operation("Verify Play purchase", { requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/PurchaseVerifyRequest" } } } } }) },
			"/account/export-requests": { get: operation("List export requests"), post: operation("Request data export", { parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }] }) },
			"/account/export-requests/{id}/chunk-url": { get: operation("Get export chunk URL", { parameters: [{ $ref: "#/components/parameters/RequestId" }, { $ref: "#/components/parameters/ExportChunkKey" }] }) },
			"/account/deletion-requests": { get: operation("List deletion requests"), post: operation("Request account deletion", { parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }] }) },
			"/account/deletion-requests/{id}/cancel": { post: operation("Cancel account deletion", { parameters: [{ $ref: "#/components/parameters/RequestId" }] }) },
			"/account/deletion-requests/{id}/confirm": { post: operation("Confirm account deletion", { parameters: [{ $ref: "#/components/parameters/RequestId" }] }) },
		},
		components: {
			securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "Session" } },
			parameters: {
				IdempotencyKey: { name: "Idempotency-Key", in: "header", required: true, schema: { type: "string", minLength: 8, maxLength: 128 } },
				Cursor: { name: "cursor", in: "query", required: false, schema: { type: "string" } },
				Limit: { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 100, default: 20 } },
				JobId: { name: "id", in: "path", required: true, schema: { type: "string", minLength: 1 } },
				RequestId: { name: "id", in: "path", required: true, schema: { type: "string", minLength: 1 } },
				ResourceId: { name: "id", in: "path", required: true, schema: { type: "string", minLength: 1, maxLength: 128 } },
				SceneId: { name: "sceneId", in: "path", required: true, schema: { type: "string", minLength: 1, maxLength: 128 } },
				VoiceId: { name: "voiceId", in: "path", required: true, schema: { type: "string", minLength: 1, maxLength: 128 } },
				AssetId: { name: "assetId", in: "path", required: true, schema: { type: "string", minLength: 1, maxLength: 128 } },
				ExportChunkKey: { name: "key", in: "query", required: true, schema: { type: "string", minLength: 1 } },
			},
			responses: {
				Unauthorized: { description: "Authentication required" },
				Validation: { description: "Request validation failed" },
			},
				schemas: {
				ApiOk: { type: "object", required: ["data"], properties: { data: {} } },
				ApiError: { type: "object", required: ["error"], properties: { error: { type: "object", required: ["code", "message"], properties: { code: { type: "string" }, message: { type: "string" } } } } },
				PurchaseVerifyRequest: jsonSchema(purchaseVerifyRequest),
				...schemaRefs,
			},
		},
	} as const;

export type OpenApiDocument = typeof openApiDocument;

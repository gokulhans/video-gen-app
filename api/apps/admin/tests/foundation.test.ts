import test from "node:test";
import assert from "node:assert/strict";
import { can, parsePermissions } from "../src/lib/permissions.ts";
import { publishCommitSucceeded, validatePublishState } from "../src/lib/publish-rules.ts";
import { sanitizeAuditValue } from "../src/lib/audit-sanitize.ts";
import { P_VIDEO_PINNED_DIGEST, P_VIDEO_TEST_CREDITS, P_VIDEO_TEST_PRICE_KEY, validatePVideoPublishState } from "../src/lib/p-video-rules.ts";
import { readFileSync } from "node:fs";

test("role permissions are resolved without trusting malformed values", () => {
	assert.deepEqual(parsePermissions(["catalog.read", 12, "catalog.read", "pricing.write"]), ["catalog.read", "pricing.write"]);
	assert.equal(can({ isSuperAdmin: false, permissions: ["catalog.read"] }, "catalog.read"), true);
	assert.equal(can({ isSuperAdmin: false, permissions: ["catalog.read"] }, "catalog.publish"), false);
	assert.equal(can({ isSuperAdmin: true, permissions: [] }, "catalog.publish"), true);
	assert.equal(can({ isSuperAdmin: false, permissions: ["characters.moderate"] }, "characters.moderate"), true);
	assert.equal(can({ isSuperAdmin: false, permissions: ["characters.write"] }, "characters.moderate"), false);
});

test("publish rules reject mutable or incomplete bindings", () => {
	assert.deepEqual(validatePublishState({ templateLifecycle: "active", versionStatus: "draft", pricingStatus: "published", bindingCount: 1, unpublishedBindingCount: 0, inputSchemaValid: true }), []);
	const errors = validatePublishState({ templateLifecycle: "archived", versionStatus: "published", pricingStatus: "draft", bindingCount: 0, unpublishedBindingCount: 1, inputSchemaValid: false });
	assert.equal(errors.length, 6);
});

test("stale or concurrent template publishes cannot claim commit success", () => {
	const expected = { versionChanges: 1, templateChanges: 1, versionStatus: "published", publishedAt: 1000, expectedPublishedAt: 1000, currentVersionId: "version-2", expectedVersionId: "version-2" };
	assert.equal(publishCommitSucceeded(expected), true);
	assert.equal(publishCommitSucceeded({ ...expected, versionChanges: 0 }), false);
	assert.equal(publishCommitSucceeded({ ...expected, templateChanges: 0 }), false);
	assert.equal(publishCommitSucceeded({ ...expected, publishedAt: 999 }), false);
	assert.equal(publishCommitSucceeded({ ...expected, currentVersionId: "version-1" }), false);
});

test("audit summaries redact credentials and bound large values", () => {
	const result = sanitizeAuditValue({ apiToken: "secret", nested: { password: "secret", label: "x" }, large: "a".repeat(700) }) as Record<string, unknown>;
	assert.equal(result.apiToken, "[redacted]");
	assert.deepEqual(result.nested, { password: "[redacted]", label: "x" });
	assert.equal((result.large as string).length, 501);
});

test("P-Video publishing is locked to the pinned Replicate model", () => {
	assert.match(P_VIDEO_PINNED_DIGEST, /^[a-f0-9]{64}$/);
	const valid = { pipelineType: "p_video", providerKey: "replicate", modelKey: "prunaai/p-video", modelVersionRef: P_VIDEO_PINNED_DIGEST, configProvider: "replicate", configModel: "prunaai/p-video", configModelVersion: P_VIDEO_PINNED_DIGEST, defaultsValid: true, mode: "test", testDefaultsValid: true, pricingKey: P_VIDEO_TEST_PRICE_KEY, creditAmount: P_VIDEO_TEST_CREDITS };
	assert.deepEqual(validatePVideoPublishState(valid), []);
	assert.equal(validatePVideoPublishState({ ...valid, providerKey: "custom", modelKey: "other", modelVersionRef: "latest", configProvider: "custom", configModel: "other", configModelVersion: "latest", defaultsValid: false }).length, 4);
	assert.equal(validatePVideoPublishState({ ...valid, testDefaultsValid: false, pricingKey: "expensive", creditAmount: 50 }).length, 2);
	assert.deepEqual(validatePVideoPublishState({ ...valid, pipelineType: "render" }), []);
});

test("static control-plane primitives expose responsive and accessible safety mechanics", () => {
	const html = readFileSync(new URL("../static/index.html", import.meta.url), "utf8");
	const js = readFileSync(new URL("../static/app.js", import.meta.url), "utf8");
	assert.match(html, /id="mobile-menu"[^>]+aria-controls="tabs"/);
	assert.match(html, /@media \(max-width: 680px\)[\s\S]+tbody td::before/);
	assert.match(js, /role="dialog" aria-modal="true" aria-labelledby=/);
	assert.match(js, /aria-live/);
	assert.match(js, /aria-current/);
	assert.match(js, /Press Cancel or Escape again to discard/);
	assert.match(html, /data-tab="character-review"/);
	assert.match(html, /\.review-layout[\s\S]+@media \(max-width: 900px\)/);
	assert.match(js, /Permission required: characters\.moderate/);
	assert.match(js, /Load private source/);
	assert.match(js, /cache: "no-store"/);
	assert.match(js, /Approve presenter/);
	assert.match(js, /Decision reason/);
});

test("character moderation API keeps source media private and decisions auditable", () => {
	const route = readFileSync(new URL("../src/routes/characters.ts", import.meta.url), "utf8");
	const wrangler = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
	assert.match(route, /requirePermission\(c, "characters\.moderate"\)/);
	assert.match(route, /UPLOADS_BUCKET\.get/);
	assert.match(route, /private, no-store, max-age=0/);
	assert.match(route, /status = 'pending_review'/);
	assert.match(route, /user_character\.\$\{body\.decision\}/);
	assert.match(route, /moderationEvidence/);
	assert.match(wrangler, /"binding": "UPLOADS_BUCKET"[\s\S]+"bucket_name": "uploads"/);
});

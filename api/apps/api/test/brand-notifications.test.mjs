import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { brandVersionCommitSucceeded, cleanupAfterBrandCommit, legacyOwnedLogoKey,decodeNotificationCursor,encodeNotificationCursor,notificationDeepLink } from "../src/lib/brand-notification.ts";

test("brand logo compatibility accepts only the owning tenant namespace", () => {
	assert.equal(legacyOwnedLogoKey("https://api.example/assets/users/user_1/brands/logos/a.png","user_1"),"users/user_1/brands/logos/a.png");
	assert.equal(legacyOwnedLogoKey("https://api.example/assets/users/user_2/brands/logos/a.png","user_1"),null);
	assert.equal(legacyOwnedLogoKey("https://evil.example/logo.png","user_1"),null);
});

test("post-commit upload cleanup failure is observable but does not fail mutation", async () => {
	let observed=false;
	await assert.doesNotReject(()=>cleanupAfterBrandCommit(async()=>{throw new Error("r2 unavailable");},()=>{observed=true;}));
	assert.equal(observed,true);
});

test("stale concurrent brand updates cannot claim version commit", () => {
	assert.equal(brandVersionCommitSucceeded(1,1,1),true);
	assert.equal(brandVersionCommitSucceeded(0,0,0),false);
	assert.equal(brandVersionCommitSucceeded(1,0,1),false);
});

test("notification cursors round-trip and reject malformed values", () => {
	const cursor=encodeNotificationCursor(1234,"notification_1");
	assert.deepEqual(decodeNotificationCursor(cursor),{createdAt:1234,id:"notification_1"});
	assert.equal(decodeNotificationCursor("bad!"),null);
});

test("job-aware notification links prefer an explicit safe application route", () => {
	assert.equal(notificationDeepLink({deepLink:"/generation/job_1/result/asset_1",jobId:"job_1",projectId:null,type:"generation_complete"}),"/generation/job_1/result/asset_1");
	assert.equal(notificationDeepLink({deepLink:null,jobId:"job 1",projectId:null,type:"generation_complete"}),"/generation/job%201");
	assert.equal(notificationDeepLink({deepLink:null,jobId:null,projectId:"project_1",type:"render_complete"}),"/render/project_1");
});

test("migration enforces tenant-scoped idempotency keys", async () => {
	const sql=await readFile(new URL("../../../packages/db/migrations/0003_brand_notifications_account.sql",import.meta.url),"utf8");
	assert.match(sql,/brand_mutations_tenant_key_unique[^;]+\(`user_id`,`idempotency_key`\)/);
	assert.match(sql,/data_export_requests_tenant_idempotency_unique[^;]+\(`user_id`,`idempotency_key`\)/);
	assert.match(sql,/account_deletion_requests_tenant_idempotency_unique[^;]+\(`user_id`,`idempotency_key`\)/);
});

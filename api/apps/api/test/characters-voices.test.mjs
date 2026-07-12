import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const characters = await readFile(new URL("../src/routes/characters.ts", import.meta.url), "utf8");
const voices = await readFile(new URL("../src/routes/voices.ts", import.meta.url), "utf8");

test("character creation requires finalized owned image and explicit consent", () => {
	assert.match(characters, /userUploadAssets\.userId, userId/);
	assert.match(characters, /userUploadAssets\.kind, "image"/);
	assert.match(characters, /userUploadAssets\.status, "ready"/);
	assert.match(characters, /confirmed: z\.literal\(true\)/);
	assert.match(characters, /'pending_review'/);
});

test("stock catalog excludes unverified expired and inactive characters", () => {
	assert.match(characters, /stockCharacters\.isActive, true/);
	assert.match(characters, /stockCharacters\.consentStatus, "verified"/);
	assert.match(characters, /stockCharacters\.licenseExpiresAt, now/);
});

test("hard delete is tenant scoped and removes source objects and upload rows", () => {
	assert.match(characters, /generationJobs\.userCharacterVersionId/);
	assert.match(characters, /UPLOADS_BUCKET\.delete/);
	assert.match(characters, /DELETE FROM user_upload_assets WHERE user_id=\? AND object_key=\?/);
	assert.match(characters, /DELETE FROM user_characters WHERE id=\? AND user_id=\?/);
});

test("voice catalog is D1 backed with tenant favorites", () => {
	assert.match(voices, /from\(schema\.voices\)/);
	assert.match(voices, /voiceFavorites\.userId, userId/);
	assert.match(voices, /onConflictDoNothing/);
});

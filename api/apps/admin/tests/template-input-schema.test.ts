import assert from "node:assert/strict";
import test from "node:test";
import { TemplateInputSchema, TemplateInputValues } from "@app/shared";

test("template contracts accept the camelCase generation input keys used by the app", () => {
	const schema = TemplateInputSchema.safeParse({
		version: 1,
		fields: [
			{
				id: "duration",
				key: "durationSec",
				type: "select",
				label: "Duration",
				required: true,
				order: 10,
				multiple: false,
				options: [{ value: 1, label: "1 second" }],
			},
			{
				id: "aspect",
				key: "aspectRatio",
				type: "select",
				label: "Aspect ratio",
				required: true,
				order: 20,
				multiple: false,
				options: [{ value: "16:9", label: "Landscape" }],
			},
		],
	});

	assert.equal(schema.success, true);
	assert.equal(TemplateInputValues.safeParse({ durationSec: 1, aspectRatio: "16:9" }).success, true);
});

test("template input keys still reject unsafe property syntax", () => {
	assert.equal(TemplateInputValues.safeParse({ "duration-sec": 1 }).success, false);
	assert.equal(TemplateInputValues.safeParse({ "1durationSec": 1 }).success, false);
	assert.equal(TemplateInputValues.safeParse({ DurationSec: 1 }).success, false);
});

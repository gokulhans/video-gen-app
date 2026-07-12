import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@app/db";
import { TemplateInputSchema, type TemplateInputSchema as TemplateInputSchemaValue } from "@app/shared";
import type { Env } from "../env";

const assetUrl = (env: Env, key: string | null) =>
	key ? `${env.APP_BASE_URL.replace(/\/$/, "")}/assets/${key.split("/").map(encodeURIComponent).join("/")}` : null;

export type CatalogTemplateVersion = {
	id: string;
	templateId: string;
	slug: string;
	version: number;
	displayName: string;
	description: string | null;
	previewUrl: string | null;
	pipelineType: string;
	capabilities: unknown;
	inputSchema: TemplateInputSchemaValue;
};

function inputField(row: typeof schema.templateInputDefinitions.$inferSelect): Record<string, unknown> {
	const constraints = row.constraints && typeof row.constraints === "object" ? row.constraints as Record<string, unknown> : {};
	return {
		id: row.id,
		key: row.fieldKey,
		type: row.fieldType,
		label: row.label,
		...(row.helpText !== null ? { helpText: row.helpText } : {}),
		required: row.isRequired,
		order: row.sortOrder,
		...constraints,
		...(row.options !== null ? { options: row.options } : {}),
		...(row.visibilityRule !== null ? { visibility: row.visibilityRule } : {}),
	};
}

export async function listPublishedCatalog(env: Env) {
	const db = getDb(env.DB);
	const categoryRows = await db.select().from(schema.categories)
		.where(eq(schema.categories.isActive, true))
		.orderBy(asc(schema.categories.sortOrder), asc(schema.categories.name));

	const versionRows = await db.select({
		id: schema.templateVersions.id,
		templateId: schema.templates.id,
		slug: schema.templates.slug,
		version: schema.templateVersions.version,
		displayName: schema.templateVersions.displayName,
		description: schema.templateVersions.description,
		previewAssetKey: schema.templateVersions.previewAssetKey,
		pipelineType: schema.templateVersions.pipelineType,
		capabilities: schema.templateVersions.capabilities,
		inputSchemaVersion: schema.templateVersions.inputSchemaVersion,
	}).from(schema.templates)
		.innerJoin(schema.templateVersions, eq(schema.templates.currentVersionId, schema.templateVersions.id))
		.where(and(
			eq(schema.templates.isActive, true),
			eq(schema.templates.lifecycleStatus, "active"),
			eq(schema.templateVersions.status, "published"),
		));

	const versionIds = versionRows.map((row) => row.id);
	const inputs = versionIds.length === 0 ? [] : await db.select().from(schema.templateInputDefinitions)
		.where(inArray(schema.templateInputDefinitions.templateVersionId, versionIds))
		.orderBy(asc(schema.templateInputDefinitions.sortOrder));
	const inputsByVersion = new Map<string, Array<Record<string, unknown>>>();
	for (const input of inputs) {
		const rows = inputsByVersion.get(input.templateVersionId) ?? [];
		rows.push(inputField(input));
		inputsByVersion.set(input.templateVersionId, rows);
	}

	const templates: CatalogTemplateVersion[] = versionRows.flatMap((row) => {
		const inputSchema = TemplateInputSchema.safeParse({
			version: row.inputSchemaVersion,
			fields: inputsByVersion.get(row.id) ?? [],
		});
		if (!inputSchema.success) {
			console.error(JSON.stringify({
				event: "published_template_schema_invalid",
				templateId: row.templateId,
				templateVersionId: row.id,
				issues: inputSchema.error.issues.map((issue) => ({ path: issue.path.join("."), code: issue.code })),
			}));
			return [];
		}
		return [{
			id: row.id,
			templateId: row.templateId,
			slug: row.slug ?? row.templateId,
			version: row.version,
			displayName: row.displayName,
			description: row.description,
			previewUrl: assetUrl(env, row.previewAssetKey),
			pipelineType: row.pipelineType,
			capabilities: row.capabilities,
			inputSchema: inputSchema.data,
		}];
	});

	const links = templates.length === 0 ? [] : await db.select({
		templateId: schema.templateCategoryLinks.templateId,
		categoryId: schema.templateCategoryLinks.categoryId,
		sortOrder: schema.templateCategoryLinks.sortOrder,
	}).from(schema.templateCategoryLinks)
		.where(inArray(schema.templateCategoryLinks.templateId, templates.map((row) => row.templateId)))
		.orderBy(asc(schema.templateCategoryLinks.sortOrder));
	const templateById = new Map(templates.map((template) => [template.templateId, template]));

	return categoryRows.map((category) => ({
		id: category.id,
		slug: category.slug,
		name: category.name,
		description: category.description,
		coverUrl: assetUrl(env, category.coverAssetKey),
		order: category.sortOrder,
		templates: links
			.filter((link) => link.categoryId === category.id)
			.map((link) => templateById.get(link.templateId))
			.filter((template): template is CatalogTemplateVersion => template !== undefined),
	}));
}

export async function getPublishedTemplate(env: Env, slugOrId: string) {
	const catalog = await listPublishedCatalog(env);
	for (const category of catalog) {
		const template = category.templates.find((item) => item.slug === slugOrId || item.id === slugOrId);
		if (template) return template;
	}
	return null;
}

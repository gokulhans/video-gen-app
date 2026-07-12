import { Hono } from "hono";
import type { AppEnv } from "../env";
import { Errors, okJson } from "../lib/response";
import { getPublishedTemplate, listPublishedCatalog } from "../services/catalog";

export const catalog = new Hono<AppEnv>();

catalog.get("/categories", async (c) => okJson(c, await listPublishedCatalog(c.env)));

catalog.get("/templates", async (c) => {
	const categories = await listPublishedCatalog(c.env);
	const templates = [...new Map(categories.flatMap((category) => category.templates).map((item) => [item.id, item])).values()];
	return okJson(c, templates);
});

catalog.get("/templates/:slugOrId", async (c) => {
	const template = await getPublishedTemplate(c.env, c.req.param("slugOrId"));
	return template ? okJson(c, template) : Errors.notFound(c, "Published template not found");
});

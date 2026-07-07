import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema.js";

export * as schema from "./schema.js";

/** @param {D1Database} d1 */
export function getDb(d1) {
	return drizzle(d1, { schema });
}

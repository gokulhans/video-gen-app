#!/usr/bin/env node
/**
 * Validate a locally-held staging resource manifest before generating Wrangler
 * env blocks. The manifest is deliberately not committed: it contains account
 * resource IDs. Usage: node scripts/validate-staging-manifest.mjs <manifest.json>
 */
import { readFile } from "node:fs/promises";

const file = process.argv[2];
if (!file) throw new Error("Usage: node scripts/validate-staging-manifest.mjs <manifest.json>");
const manifest = JSON.parse(await readFile(file, "utf8"));
if (manifest.environment !== "staging") throw new Error("Manifest environment must be staging");

const required = [
  ["workers", ["api", "pipeline", "render", "admin", "app"]],
  ["r2", ["assets", "uploads", "renders", "exports"]],
  ["queues", ["render", "dlq"]],
];
for (const [section, keys] of required) {
  for (const key of keys) {
    const value = manifest[section]?.[key];
    if (typeof value !== "string" || value.length < 3) throw new Error(`Missing ${section}.${key}`);
    if (!value.endsWith("-staging")) throw new Error(`${section}.${key} must end with -staging`);
  }
}
for (const [section, key] of [["d1", "id"], ["kv", "id"]]) {
  if (typeof manifest[section]?.[key] !== "string" || !manifest[section][key].trim()) {
    throw new Error(`Missing ${section}.${key}`);
  }
}
if (manifest.d1.name !== "ai-video-db-staging") throw new Error("d1.name must be ai-video-db-staging");
if (manifest.kv.name !== "ai-video-kv-staging") throw new Error("kv.name must be ai-video-kv-staging");
if (typeof manifest.stream?.customerCode !== "string" || !manifest.stream.customerCode.trim()) {
  throw new Error("Missing stream.customerCode");
}
if (typeof manifest.aiGateway?.baseUrl !== "string" || !manifest.aiGateway.baseUrl.includes("ai-video-staging")) {
  throw new Error("aiGateway.baseUrl must target ai-video-staging");
}

const production = manifest.production ?? {};
const stagingValues = [
  ...Object.values(manifest.workers),
  ...Object.values(manifest.r2),
  ...Object.values(manifest.queues),
  manifest.d1.id,
  manifest.kv.id,
  manifest.stream.customerCode,
  manifest.aiGateway.baseUrl,
];
const productionValues = new Set([
  ...(production.workers ? Object.values(production.workers) : []),
  ...(production.r2 ? Object.values(production.r2) : []),
  ...(production.queues ? Object.values(production.queues) : []),
  production.d1Id,
  production.kvId,
  production.streamCustomerCode,
  production.aiGatewayBaseUrl,
].filter(Boolean));
const collisions = stagingValues.filter((value) => productionValues.has(value));
if (collisions.length) throw new Error(`Staging/production collision: ${[...new Set(collisions)].join(", ")}`);

console.log(`staging manifest valid: ${manifest.workers.api}, ${manifest.d1.id}`);

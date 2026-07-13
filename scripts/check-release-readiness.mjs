import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";

const environment = process.argv.includes("--env")
  ? process.argv[process.argv.indexOf("--env") + 1]
  : "production";

if (!["production", "staging"].includes(environment)) {
  throw new Error("Usage: node scripts/check-release-readiness.mjs [--env production|staging]");
}

const root = fileURLToPath(new URL("..", import.meta.url));
const workers = [
  { name: "api", config: "api/apps/api/wrangler.jsonc", required: ["BETTER_AUTH_SECRET", "MEDIA_INGEST_SIGNING_SECRET", "DELETION_TOMBSTONE_SECRET", "R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"] },
  { name: "pipeline", config: "api/apps/pipeline/wrangler.jsonc", required: ["OPENAI_API_KEY", "GEMINI_API_KEY", "REPLICATE_API_TOKEN", "MEDIA_INGEST_SIGNING_SECRET"] },
  { name: "render", config: "api/apps/render/wrangler.jsonc", required: ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"] },
  { name: "admin", config: "api/apps/admin/wrangler.jsonc", required: [] },
];

const failures = [];
for (const worker of workers) {
  const configPath = path.join(root, worker.config);
  if (!existsSync(configPath)) {
    failures.push(`${worker.name}: missing Wrangler config ${worker.config}`);
    continue;
  }

  const config = readFileSync(configPath, "utf8");
  const envIndex = config.indexOf('"env"');
  const block = environment === "staging"
    ? (envIndex >= 0 ? config.slice(envIndex) : "")
    : (envIndex >= 0 ? config.slice(0, envIndex) : config);
  for (const marker of ["replace-with-", "<staging-", "<account-subdomain>"]) {
    if (block.includes(marker)) failures.push(`${worker.name}: placeholder ${marker} remains in ${environment} config`);
  }

  const workerDirectory = path.dirname(configPath);
  const args = ["wrangler", "secret", "list", "--config", "wrangler.jsonc"];
  if (environment === "staging") args.push("--env", "staging");
  const result = process.platform === "win32"
    ? spawnSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", `npx.cmd ${args.join(" ")}`], { cwd: workerDirectory, encoding: "utf8" })
    : spawnSync("npx", args, { cwd: workerDirectory, encoding: "utf8" });
  if (result.status !== 0) {
    failures.push(`${worker.name}: Worker is not deployed or secret list failed`);
    continue;
  }
  let names = [];
  try {
    names = JSON.parse(result.stdout).map((secret) => secret.name);
  } catch {
    failures.push(`${worker.name}: Wrangler returned non-JSON secret output`);
    continue;
  }
  for (const secret of worker.required) {
    if (!names.includes(secret)) failures.push(`${worker.name}: missing secret ${secret}`);
  }
}

if (failures.length) {
  console.error(`${environment} release readiness: BLOCKED`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`${environment} release readiness: READY (configuration and required secrets present)`);
}

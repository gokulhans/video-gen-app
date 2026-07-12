import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = new URL("../", import.meta.url).pathname.replace(/^\/(.:)/, "$1");
const apiRoot = join(repoRoot, "api");
const persistTo = mkdtempSync(join(tmpdir(), "ai-video-d1-ci-"));
const wranglerCli = join(apiRoot, "node_modules", "wrangler", "bin", "wrangler.js");

function wrangler(args, capture = false) {
  const result = spawnSync(process.execPath, [wranglerCli, "d1", ...args], {
    cwd: apiRoot,
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
  });
  if (result.status !== 0) throw new Error(`wrangler d1 ${args.join(" ")} failed`);
  return result.stdout ?? "";
}

try {
  const common = ["--local", "--persist-to", persistTo, "--config", "apps/api/wrangler.jsonc"];
  wrangler(["migrations", "apply", "ai-video-db", ...common]);
  wrangler(["execute", "ai-video-db", ...common, "--file", "packages/db/seed.sql"]);
  const output = wrangler([
    "execute", "ai-video-db", ...common, "--command",
    "PRAGMA foreign_keys=ON; PRAGMA foreign_key_check; SELECT COUNT(*) AS templates FROM template_versions WHERE status='published';",
    "--json",
  ], true);
  const parsed = JSON.parse(output);
  const resultSets = Array.isArray(parsed) ? parsed : [parsed];
  // The first result belongs to `PRAGMA foreign_keys=ON`; violations are
  // returned by the following `foreign_key_check` result set. Aggregate every
  // result before the final template-count query so a non-first violation can
  // never be missed.
  const foreignKeyRows = resultSets
    .slice(0, -1)
    .flatMap((result) => result?.results ?? []);
  const publishedTemplates = Number(resultSets.at(-1)?.results?.[0]?.templates ?? 0);
  if (foreignKeyRows.length !== 0) throw new Error(`foreign_key_check returned ${foreignKeyRows.length} violation(s)`);
  if (!Number.isSafeInteger(publishedTemplates) || publishedTemplates < 1) throw new Error("seed produced no published template versions");
  console.log(JSON.stringify({ event: "d1_validation_passed", publishedTemplates }));
} finally {
  rmSync(persistTo, { recursive: true, force: true });
}

# Cloudflare staging provisioning

This repository currently contains one live resource set in the top-level
`wrangler.jsonc` files. This document is the concrete, repeatable procedure
for creating an isolated staging set. It does not modify production configs or
create resources by itself.

## Canonical staging names

Use the following names in account `58f07fb13c26e83dd6109d957083478d` (or use a
dedicated Cloudflare account when Stream isolation is required):

| Resource | Staging name |
|---|---|
| D1 | `ai-video-db-staging` |
| KV | `ai-video-kv-staging` |
| R2 | `assets-staging`, `uploads-staging`, `renders-staging`, `exports-staging` |
| Queues | `render-queue-staging`, `render-dlq-staging` |
| Workers | `api-staging`, `pipeline-staging`, `render-staging`, `admin-staging`, `zellyo-app-staging` |
| AI Gateway | `ai-video-staging` |

The staging API, pipeline, render worker, and admin worker now have explicit
`env.staging` binding blocks in their Wrangler files and must use those staging
bindings. Workflows and Durable Objects are isolated by the staging
Worker scripts; keep their class names and migration tags compatible with the
source config. The renderer container is also deployed by `render-staging` and
must not reuse a production R2 API token.

Current account status: the staging D1, KV, four R2 buckets, and render/DLQ
queues have been provisioned; migrations `0000`–`0007` and seed data have been
applied to the staging D1, and all staging Worker dry-runs pass. Remaining
steps are protected secrets, a staging Stream customer code (or an approved
shared-account namespace), and provider/store smoke approval.

## Provision resources

Run from `api/apps/api` after selecting the intended account. These commands
are intentionally explicit; record every returned ID in the protected staging
environment, not in Git:

```powershell
$env:CLOUDFLARE_ACCOUNT_ID = '58f07fb13c26e83dd6109d957083478d'
npx wrangler d1 create ai-video-db-staging
npx wrangler kv namespace create ai-video-kv-staging
npx wrangler r2 bucket create assets-staging
npx wrangler r2 bucket create uploads-staging
npx wrangler r2 bucket create renders-staging
npx wrangler r2 bucket create exports-staging
npx wrangler queues create render-queue-staging
npx wrangler queues create render-dlq-staging
```

Configure the four R2 buckets as private and add the multipart-abort rule
(24-hour or seven-day maximum). Do not add object-expiry rules to masters,
renders, or exports. Restrict the staging R2 API token to only the four
`*-staging` buckets.

## Wrangler environment shape

Keep the current top-level configuration as production. The committed
`env.staging` blocks contain the provisioned D1/KV IDs and canonical R2/queue
names. If a new account is used, replace those IDs in a protected
environment-specific config or generate an equivalent untracked config in CI.
The block
must override every resource-bearing field, not only the Worker name:

```jsonc
{
  "env": {
    "staging": {
      "name": "api-staging",
      "vars": {
        "APP_BASE_URL": "https://api-staging.<account-subdomain>.workers.dev",
        "ALLOWED_ORIGINS": "https://zellyo-app-staging.<account-subdomain>.workers.dev",
        "AI_GATEWAY_BASE_URL": "https://gateway.ai.cloudflare.com/v1/<account>/ai-video-staging",
        "STREAM_CUSTOMER_CODE": "<staging-stream-code>"
      },
      "d1_databases": [{ "binding": "DB", "database_name": "ai-video-db-staging", "database_id": "<staging-d1-id>", "migrations_dir": "../../packages/db/migrations" }],
      "kv_namespaces": [{ "binding": "KV", "id": "<staging-kv-id>" }],
      "r2_buckets": [
        { "binding": "ASSETS_BUCKET", "bucket_name": "assets-staging" },
        { "binding": "UPLOADS_BUCKET", "bucket_name": "uploads-staging" },
        { "binding": "RENDERS_BUCKET", "bucket_name": "renders-staging" },
        { "binding": "EXPORTS_BUCKET", "bucket_name": "exports-staging" }
      ]
    }
  }
}
```

The pipeline staging block must also override all workflow names/bindings to
the `*-staging` Workers and use a staging queue/Stream binding. The render
block must use `render-staging`, `render-queue-staging`, staging Durable Object
migrations, and a staging container rollout. The admin block must point
`AUTH_API_URL` to `api-staging`. The app's `app/wrangler.jsonc` should be
deployed with a separate staging project/name and staging API `dart-define`
values.

Before deployment, compare the generated configs and fail if any staging
database ID, KV ID, bucket name, queue name, Worker name, Stream code, or AI
Gateway URL equals production. Never use a production config with only
`APP_BASE_URL` changed.

## Secrets and external service blockers

Create separate secrets for every staging Worker. In particular:

- a unique `BETTER_AUTH_SECRET` and `DELETION_TOMBSTONE_SECRET`;
- a staging-only R2 access token and `R2_*` values;
- a new random `MEDIA_INGEST_SIGNING_SECRET` shared only by staging API and pipeline;
- staging-scoped OpenAI, Gemini, and Replicate keys with hard spend limits;
- a staging Firebase project/service account and Android `google-services.json`;
- staging Google OAuth redirect URI and (if billing is enabled) a separate Play
  license/test-track configuration.

Cloudflare Stream customer codes are account-scoped. A genuinely isolated
staging Stream library therefore requires a separate Cloudflare account (or a
documented, accepted shared-account namespace with separate access controls).
Do not silently reuse the production Stream customer code. AI Gateway can be a
separate gateway in the same account, but it must use staging provider keys,
budgets, and logs.

## Deploy and prove isolation

Apply migrations and seed only after checking the staging D1 ID:

```powershell
npx wrangler d1 migrations apply ai-video-db-staging --remote --config <staging-config>
npx wrangler d1 execute ai-video-db-staging --remote --command "PRAGMA foreign_key_check" --config <staging-config>
```

Deploy in dependency order: pipeline, render, API, admin, then the Flutter web
assets. Use `--env staging` (or the generated staging config) for every command.
Run free auth/catalog/upload/render-contract smoke checks with a dedicated
test tenant. Paid Replicate calls require the protected paid-smoke approval;
the staging provider adapter must remain one-second/720p/no-audio.

Record the resulting Worker version IDs, migration list, queue/DLQ names, R2
bucket names, Stream code, and AI Gateway in the release record. If any check
shows a production identifier, stop before traffic or secrets are introduced.

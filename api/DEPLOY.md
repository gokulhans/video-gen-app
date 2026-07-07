# Deploy Runbook — Cloudflare Stack

Order matters: resources → secrets → pipeline → render → api → admin.
All commands from the monorepo root (`appplan/api`). Requires `pnpm i` done and
`wrangler login` against the target Cloudflare account.

## 1. Create resources (once per environment)

```sh
wrangler d1 create ai-video-db            # → paste database_id into ALL four apps' wrangler.jsonc
wrangler kv namespace create KV           # → paste id into apps/api + apps/admin wrangler.jsonc
wrangler r2 bucket create assets
wrangler r2 bucket create renders
wrangler r2 bucket create uploads
wrangler queues create render-queue
wrangler queues create render-dlq
```

Apply schema + seed:

```sh
wrangler d1 migrations apply ai-video-db --remote   # run from packages/db (migrations/0000_init.sql)
wrangler d1 execute ai-video-db --remote --file=packages/db/seed.sql
```

## 2. AI Gateway

Dashboard → AI → AI Gateway → create gateway `ai-video`. Set each worker's
`AI_GATEWAY_BASE_URL` var to
`https://gateway.ai.cloudflare.com/v1/<ACCOUNT_ID>/ai-video`.

## 3. R2 S3 credentials (for presigning + container upload)

Dashboard → R2 → Manage API Tokens → create key pair scoped to the three buckets.

## 4. Secrets (per app that needs them — see each app's README)

```sh
# apps/api
wrangler secret put BETTER_AUTH_SECRET
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_CLIENT_SECRET
wrangler secret put R2_ACCOUNT_ID && wrangler secret put R2_ACCESS_KEY_ID && wrangler secret put R2_SECRET_ACCESS_KEY
wrangler secret put GOOGLE_PLAY_SERVICE_ACCOUNT_JSON && wrangler secret put GOOGLE_PLAY_PACKAGE_NAME
# apps/pipeline
wrangler secret put OPENAI_API_KEY && wrangler secret put GEMINI_API_KEY && wrangler secret put REPLICATE_API_TOKEN
wrangler secret put FCM_SERVICE_ACCOUNT_JSON
# apps/render
wrangler secret put FCM_SERVICE_ACCOUNT_JSON
wrangler secret put R2_ACCOUNT_ID && wrangler secret put R2_ACCESS_KEY_ID && wrangler secret put R2_SECRET_ACCESS_KEY
```

## 5. Deploy (dependency order)

```sh
pnpm --filter @app/pipeline deploy   # workflows must exist before api binds them
pnpm --filter @app/render deploy     # DO + container + queue consumer (needs Docker running for image build)
pnpm --filter @app/api deploy
pnpm --filter @app/admin deploy
```

## 6. Data migration from the old stack (plan §7)

1. `DATABASE_URL=<neon-url> node scripts/migrate-from-neon.mjs > migration-data.sql`
2. `wrangler d1 execute ai-video-db --remote --file=migration-data.sql`
3. Assets: `rclone copy s3:<old-bucket> r2:assets` (S3-compatible both sides)
4. Keep a read-only Neon snapshot for 30 days.

## 7. Smoke test

```sh
curl https://api.<domain>/api/v1/templates          # 401 → auth works; with token → seeded templates
# sign up via better-auth, create project, POST /generate, watch generation-status,
# POST /render, poll /render-jobs/:id → download presigned URL.
```

## Placeholders to replace before deploy
- `database_id` / KV `id` in every wrangler.jsonc
- `AI_GATEWAY_BASE_URL`, `APP_BASE_URL` vars
- Flutter app base URL (appplan/app README)

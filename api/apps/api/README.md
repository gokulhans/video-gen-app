# apps/api — API Worker

Hono-based Cloudflare Worker exposing the public REST API (`/api/v1/*`) and
the better-auth handler (`/api/auth/*`). Binding names match
`../../CONTRACTS.md` exactly.

## Bindings to create (once per environment)

```bash
# D1
wrangler d1 create ai-video-db
# → paste the returned database_id into wrangler.jsonc (d1_databases[0].database_id)

# KV
wrangler kv namespace create KV
# → paste the returned id into wrangler.jsonc (kv_namespaces[0].id)

# R2 buckets (shared across api/pipeline/render — only create once globally)
wrangler r2 bucket create assets
wrangler r2 bucket create renders
wrangler r2 bucket create uploads

# Queue (producer here, consumer lives in apps/render)
wrangler queues create render-queue
```

The `workflows` bindings (`GENERATION_PIPELINE`, `REGEN_IMAGE`, `REGEN_VOICE`)
and the `RENDER_SERVICE` service binding point at the `pipeline` and `render`
Workers respectively — deploy those apps first (or at least once) so the
binding target script names resolve.

## Secrets

From `CONTRACTS.md`:

```bash
wrangler secret put OPENAI_API_KEY
wrangler secret put GEMINI_API_KEY
wrangler secret put REPLICATE_API_TOKEN
wrangler secret put FCM_SERVICE_ACCOUNT_JSON
wrangler secret put EMAIL_API_KEY
wrangler secret put BETTER_AUTH_SECRET
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_CLIENT_SECRET
```

**Additional secrets not listed in `CONTRACTS.md`** (see "Deviations" below):

```bash
# R2 S3-API credentials, needed to presign URLs with aws4fetch (the R2
# binding itself cannot mint presigned URLs — only an R2 API token can).
# Create at: Cloudflare dashboard → R2 → Manage API tokens.
wrangler secret put R2_ACCOUNT_ID
wrangler secret put R2_ACCESS_KEY_ID
wrangler secret put R2_SECRET_ACCESS_KEY

# Google Play Billing server-side verification (separate from the FCM
# service account). Full service-account JSON blob, PKCS#8 private key.
wrangler secret put GOOGLE_PLAY_SERVICE_ACCOUNT_JSON
wrangler secret put GOOGLE_PLAY_PACKAGE_NAME
wrangler secret put MEDIA_INGEST_SIGNING_SECRET # same value on api + pipeline
```

## Deploy

```bash
pnpm install          # from the monorepo root (appplan/api)
pnpm --filter @app/api typecheck
pnpm --filter @app/api deploy
```

Local dev: `pnpm --filter @app/api dev` (wrangler dev; D1/KV/R2 run against
local emulated storage unless you pass `--remote`).

## Deviations from CONTRACTS.md

None to the binding names or route surface. Two implementation details
required secrets that CONTRACTS.md's secrets list doesn't enumerate — both
are additive (new secrets only, nothing renamed/removed):

1. **R2 presigned URLs** (`POST /assets/upload-url`, `POST
   /assets/download-url`) need S3-compatible credentials (`R2_ACCOUNT_ID`,
   `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`) to sign requests with
   `aws4fetch`. The R2 bucket *binding* lets a Worker read/write directly,
   but cannot itself mint a presigned URL for a client to hit directly —
   that requires the R2 S3 API + an access key pair.
2. **Google Play Billing verification** (`POST /tokens/purchase/verify`)
   needs a Google Cloud service account JSON (`GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`)
   with Play Console API access, distinct from the FCM service account
   already in CONTRACTS.md. The JWT-signing helper
   (`src/lib/google-play.ts`) is fully implemented (RS256 via WebCrypto,
   OAuth2 JWT-bearer exchange, `purchases.products.get` call) — the only
   missing piece for production is populating the real private key in that
   secret. See the `TODO(secrets)` comment in that file.

## Route summary

All under `/api/v1`, Bearer session required (better-auth), zod-validated,
`{ data }` / `{ error: { code, message } }` envelope.

- `projects`
  - `GET /projects` — list own
  - `GET /projects/:id` — get own
  - `POST /projects` — create `{ name, templateId?, brandId? }`
  - `DELETE /projects/:id`
  - `PATCH /projects/:id/composition` — autosave, body = `ProjectComposition`
  - `POST /projects/:id/generate` — body = `GenerationParams` minus
    `projectId`/`userId`; starts `GENERATION_PIPELINE` workflow, stores
    `workflowInstanceId` + `generationStatus=running`. Rate-limited
    (5/min/user).
  - `GET /projects/:id/generation-status` — D1 status + live workflow
    `instance.status()`
- `render`
  - `POST /projects/:id/render` — `{ resolution }`; token check via
    `db.batch` (select balance → conditional decrement → ledger insert, 0
    rows affected = insufficient funds), inserts `render_jobs` row, sends
    `RenderQueueMessage` to `RENDER_QUEUE`, best-effort inits the
    `RenderJobDO` via `RENDER_SERVICE` `POST /do/:jobId/init`. Rate-limited
    (3/min/user).
  - `GET /render-jobs/:id` — proxies `RENDER_SERVICE` `GET
    /do/:jobId/status`, falls back to the D1 row if the DO call fails.
  - `GET /render-jobs/:id/ws` — proxies the WebSocket upgrade to
    `RENDER_SERVICE` `/do/:jobId/ws`.
- `tokens`
  - `GET /tokens/balance`
  - `GET /tokens/history?limit=`
  - `GET /tokens/cost-estimate?templateId=&durationSec=` — sums
    script + voice + images (`scenes ≈ durationSec/4`) + both render tiers
    from the `token_costs` table.
  - `POST /tokens/purchase/verify` — `{ productId, purchaseToken,
    tokenAmount }`; verifies with Android Publisher API, credits tokens via
    `db.batch`, idempotent on `purchaseToken`.
- `templates`
  - `GET /templates` — KV (`templates:v1`) first, D1 (`isActive`) fallback +
    write-through.
- `brands` — full CRUD, own only.
- `notifications`
  - `GET /notifications?limit=`
  - `POST /notifications/:id/read`
  - `POST /notifications/read-all`
- `devices`
  - `POST /devices/register` — `{ fcmToken, platform }`, upsert by
    `fcmToken`.
- `assets`
  - `POST /assets/upload-url` — `{ kind: "image"|"audio", contentType }` →
    presigned PUT into `UPLOADS_BUCKET` under `${userId}/${kind}/...`.
  - `POST /assets/download-url` — `{ bucket: "assets"|"renders", key }` →
    presigned GET; 403 unless `key` starts with `${userId}/`.
  - `GET /assets/generation/:assetId` — tenant-scoped generation media. A
    Stream playback asset returns signed HLS/DASH URLs; an R2 master returns a
    short-lived presigned download URL.

Set the non-secret `STREAM_CUSTOMER_CODE` variable to the unique code shown in
the Cloudflare Stream dashboard (without the `customer-` prefix). The native
`STREAM` binding generates playback tokens; no Stream REST API token is used.

## curl examples

```bash
# Sign up (better-auth email+password)
curl -X POST https://api.example.com/api/auth/sign-up/email \
  -H "content-type: application/json" \
  -d '{"email":"a@b.com","password":"hunter2!","name":"Ada"}'

# Sign in — response includes a Bearer token (bearer plugin)
curl -X POST https://api.example.com/api/auth/sign-in/email \
  -H "content-type: application/json" \
  -d '{"email":"a@b.com","password":"hunter2!"}'

# List projects
curl https://api.example.com/api/v1/projects \
  -H "Authorization: Bearer <token>"

# Create a project
curl -X POST https://api.example.com/api/v1/projects \
  -H "Authorization: Bearer <token>" -H "content-type: application/json" \
  -d '{"name":"My first video","templateId":"restaurant-1"}'

# Start generation
curl -X POST https://api.example.com/api/v1/projects/<id>/generate \
  -H "Authorization: Bearer <token>" -H "content-type: application/json" \
  -d '{"templateId":"restaurant-1","topic":"Grand opening promo","durationSec":45,"voice":"alloy"}'

# Cost estimate
curl "https://api.example.com/api/v1/tokens/cost-estimate?templateId=restaurant-1&durationSec=45" \
  -H "Authorization: Bearer <token>"

# Queue a render
curl -X POST https://api.example.com/api/v1/projects/<id>/render \
  -H "Authorization: Bearer <token>" -H "content-type: application/json" \
  -d '{"resolution":"720p"}'

# Presigned upload URL
curl -X POST https://api.example.com/api/v1/assets/upload-url \
  -H "Authorization: Bearer <token>" -H "content-type: application/json" \
  -d '{"kind":"image","contentType":"image/png"}'
```

## TODOs

- [ ] Populate `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` with a real private key
      before enabling `/tokens/purchase/verify` in production
      (`src/lib/google-play.ts`).
- [ ] Wire Turnstile on signup once the mobile client supports it (plan §6
      mentions this; out of scope for this worker's initial cut).
- [ ] Confirm `db.batch()` result shape for D1 in the installed drizzle-orm
      version — `src/routes/render.ts` reads `meta.changes`/`rowsAffected`
      defensively; tighten once `pnpm install` resolves real types.

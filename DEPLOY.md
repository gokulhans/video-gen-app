# Deployment & Environment Guide

Live stack (Cloudflare account: Gokulhansv@gmail.com / `58f07fb13c26e83dd6109d957083478d`):

| Service | URL |
|---|---|
| API | https://api.gokulhansv.workers.dev |
| Pipeline (Workflows) | https://pipeline.gokulhansv.workers.dev |
| Render (Queue + DO + Container) | https://render.gokulhansv.workers.dev |
| Admin dashboard | https://admin.gokulhansv.workers.dev |

Already provisioned: D1 `ai-video-db` (`42aede4d-4f0c-41da-86d0-4a2bce18d83a`, migrated + seeded),
KV `ai-video-kv` (`5a5e2238fcc5423d8a9d3ec4dd94121f`), R2 buckets `assets` / `renders` / `uploads`,
Queues `render-queue` / `render-dlq`. All IDs are committed in each app's `wrangler.jsonc`.

---

## 1. Secrets — what, where, and how

Secrets are set with `wrangler secret put NAME` **from the app's directory**
(`api/apps/<app>`), because the directory's `wrangler.jsonc` pins the worker
name and account. The command prompts for the value; for multi-line JSON, pipe
a file instead. Secrets apply immediately — no redeploy needed.

### api worker (`api/apps/api`)

| Secret | Required for | Where to get it | Status |
|---|---|---|---|
| `BETTER_AUTH_SECRET` | all auth (session signing) | any random 32+ chars (`openssl rand -base64 32`) | ✅ set |
| `R2_ACCOUNT_ID` | presigned upload/download URLs | it's the account id: `58f07fb13c26e83dd6109d957083478d` | ⬜ |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | presigned URLs | Dashboard → R2 → Manage API Tokens → Create API token → permission **Object Read & Write** on buckets `assets`, `renders`, `uploads`. Shown once — copy both values | ⬜ |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google sign-in | console.cloud.google.com → APIs & Services → Credentials → Create OAuth client (type **Web application**; authorized redirect URI `https://api.gokulhansv.workers.dev/api/auth/callback/google`) | ⬜ optional at first |
| `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` | token purchase verification | Play Console → Setup → API access → service account key JSON | ⬜ later, needs Play Console |
| `GOOGLE_PLAY_PACKAGE_NAME` | same | your final Android applicationId | ⬜ later |

```powershell
cd api\apps\api
echo 58f07fb13c26e83dd6109d957083478d | npx wrangler secret put R2_ACCOUNT_ID
npx wrangler secret put R2_ACCESS_KEY_ID
npx wrangler secret put R2_SECRET_ACCESS_KEY
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
```

### pipeline worker (`api/apps/pipeline`)

| Secret | Required for | Where to get it |
|---|---|---|
| `OPENAI_API_KEY` | script, TTS, Whisper timestamps | platform.openai.com → API keys |
| `GEMINI_API_KEY` | script fallback + Gemini TTS (Indian languages) | aistudio.google.com → Get API key |
| `REPLICATE_API_TOKEN` | Flux image generation | replicate.com → Account → API tokens |
| `FCM_SERVICE_ACCOUNT_JSON` | push notification on generation complete | Firebase console → Project settings → Service accounts → Generate new private key |

```powershell
cd api\apps\pipeline
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put REPLICATE_API_TOKEN
Get-Content C:\path\to\firebase-service-account.json -Raw | npx wrangler secret put FCM_SERVICE_ACCOUNT_JSON
```

### render worker (`api/apps/render`)

| Secret | Required for | Where to get it |
|---|---|---|
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | container uploads finished MP4 to R2 (forwarded into the container as env vars) | same R2 API token as above |
| `FCM_SERVICE_ACCOUNT_JSON` | push notification on render complete/failed | same Firebase key as above |

```powershell
cd api\apps\render
echo 58f07fb13c26e83dd6109d957083478d | npx wrangler secret put R2_ACCOUNT_ID
npx wrangler secret put R2_ACCESS_KEY_ID
npx wrangler secret put R2_SECRET_ACCESS_KEY
Get-Content C:\path\to\firebase-service-account.json -Raw | npx wrangler secret put FCM_SERVICE_ACCOUNT_JSON
```

### admin worker
No secrets. Admin auth = Bearer token of any user whose `is_admin` = 1 in D1.
Promote yourself:

```powershell
cd api\apps\api
npx wrangler d1 execute ai-video-db --remote --command "UPDATE user SET is_admin = 1 WHERE email = 'you@example.com'"
```

**Minimum to generate a first video:** the 3 AI keys on pipeline + R2 keys on
api and render. FCM / Google OAuth / Play Billing can wait (push and Google
login simply won't work yet; email+password auth already works).

## 2. Plain vars (committed in wrangler.jsonc, not secrets)

| Var | Where | Current value |
|---|---|---|
| `AI_GATEWAY_BASE_URL` | api, pipeline | `https://gateway.ai.cloudflare.com/v1/58f07fb13c26e83dd6109d957083478d/ai-video` |
| `APP_BASE_URL` | api, pipeline | `https://api.gokulhansv.workers.dev` |
| `AUTH_API_URL` | admin | `https://api.gokulhansv.workers.dev/api/auth` |

⚠️ **AI Gateway must exist**: Dashboard → AI → AI Gateway → Create gateway →
name it exactly `ai-video`. Pipeline AI calls fail until this exists (one-time,
free, gives per-provider spend logs + caching).

## 3. Container image (CI — no local Docker)

`.github/workflows/deploy-render-container.yml` builds the Remotion container
on GitHub runners and deploys the render worker. One-time setup:

1. Cloudflare Dashboard → My Profile → API Tokens → Create Token → template
   **Edit Cloudflare Workers** → scope to the Gokulhansv account.
2. GitHub repo → Settings → Secrets and variables → Actions → new secret
   `CLOUDFLARE_API_TOKEN`.
3. Actions tab → *Deploy render worker + container* → Run workflow
   (also auto-runs on pushes touching `api/apps/render/**`,
   `api/containers/renderer/**`, `api/packages/**`).

## 4. Flutter app env

Base URLs default to production (in `app/lib/core/constants.dart`). Override
per build if needed:

```sh
flutter run --dart-define=API_BASE_URL=https://api.gokulhansv.workers.dev/api/v1 `
            --dart-define=AUTH_BASE_URL=https://api.gokulhansv.workers.dev/api/auth
```

Firebase (push): add `android/app/google-services.json` from the Firebase
console (same project as `FCM_SERVICE_ACCOUNT_JSON`). Not committed — it's
per-environment.

## 5. Redeploying workers after code changes

```powershell
cd api
pnpm install
pnpm -r typecheck
cd apps\pipeline; npx wrangler deploy          # workflows
cd ..\render;    npx wrangler deploy           # needs Docker — use CI instead
cd ..\api;       npx wrangler deploy
cd ..\admin;     npx wrangler deploy
```

(Local `wrangler deploy` for render without Docker: add `--containers-rollout=none`
to update only the worker code, keeping the existing container image.)

## 6. Smoke test

```sh
curl https://api.gokulhansv.workers.dev/health                        # {"ok":true}
curl -X POST https://api.gokulhansv.workers.dev/api/auth/sign-up/email \
  -H "content-type: application/json" \
  -d '{"email":"me@test.com","password":"Passw0rd!123","name":"Me"}'  # → {token,...}
curl https://api.gokulhansv.workers.dev/api/v1/templates -H "Authorization: Bearer <token>"
```

Full flow: create project → `POST /api/v1/projects/:id/generate` → poll
`generation-status` → `POST /api/v1/projects/:id/render` → poll
`/api/v1/render-jobs/:id` → presigned download via `/api/v1/assets/download-url`.

## 7. Data migration from the old Next.js stack (when ready)

```sh
DATABASE_URL=<neon-url> node api/scripts/migrate-from-neon.mjs > migration-data.sql
cd api/apps/api && npx wrangler d1 execute ai-video-db --remote --file=../../../migration-data.sql
rclone copy s3:<old-bucket> r2:assets     # assets; keep Neon snapshot 30 days
```

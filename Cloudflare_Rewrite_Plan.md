# Cloudflare Full Rewrite — Complete Technical Plan

Rewrite of the AI video SaaS backend (currently Next.js + Neon Postgres + AWS
Remotion Lambda + S3/SQS) onto a 100% Cloudflare stack, serving the Flutter
mobile app (and later web).

---

## 1. Target Architecture

```
Flutter app
   │  HTTPS (Bearer token)
   ▼
API Worker (Hono) ──────────────► KV (sessions cache, templates cache, config)
   │        │                     D1 (users, projects, tokens, jobs, templates)
   │        │
   │        ├─► Workflows: GenerationPipeline (script→TTS→timestamps→scenes→images)
   │        │        │
   │        │        └─► AI Gateway ─► OpenAI / Gemini / Replicate
   │        │        └─► R2 (voiceover.mp3, images, project assets)
   │        │
   │        ├─► Queues: render-queue ─► Render Consumer Worker
   │        │                              │
   │        │                              └─► Container DO (Remotion + Chromium)
   │        │                                     │ renders MP4 → R2
   │        │                                     └─► progress → RenderJob DO
   │        │
   │        └─► RenderJob DO (per-job live state, WebSocket/poll progress)
   │
   ├─► Cloudflare Images (user-uploaded photos, logos — resize/optimize)
   ├─► Push Worker (FCM HTTP v1) + Email (Cloudflare Email Service / Resend)
   └─► Cron Triggers (cleanup, stuck-job reaper, token expiry)

Admin dashboard: separate Worker with static assets (React), same D1.
```

### Service-by-service mapping from the current stack

| Current | Cloudflare replacement | Notes |
|---|---|---|
| Next.js API routes (Vercel) | **Workers** + Hono router | One API worker; service bindings to others |
| Neon Postgres + Drizzle | **D1** + Drizzle (`drizzle-orm/d1`) | Same schema definitions, SQLite dialect |
| better-auth | **better-auth on Workers** (D1 adapter + KV secondary storage) | Officially supported; keep Google OAuth + email/password |
| S3 + presigned URLs | **R2** (S3-compatible API + presigned URLs) | `@aws-sdk/client-s3` works pointed at R2 endpoint |
| SQS | **Queues** | Render dispatch + webhook fan-out |
| Remotion Lambda | **Containers** (Remotion `renderMedia` in Docker) | The big migration — see §4 |
| Render progress polling (DB) | **Durable Object** per render job | Live progress, WebSocket-capable |
| Trigger.dev | **Workflows** | Durable multi-step generation pipeline |
| Nodemailer/SMTP | **Email Service** (or Resend API) | Transactional email |
| Browser notifications | **FCM push** (mobile) via Worker | Store fcmToken per device |
| Direct OpenAI/Gemini/Replicate calls | Same providers via **AI Gateway** | Caching, retries, fallback routing, spend analytics per provider |
| — | **Workers AI** (optional) | Fallback/cheap tier: Llama for scripts, Flux on Workers AI for images |
| — | **Turnstile** | Bot protection on signup (token farming defense) |
| Clarity/GA | **Analytics Engine** | Funnel + per-stage cost metrics, high-cardinality |

---

## 2. Repo & Deployment Layout

Monorepo (pnpm workspaces), one `wrangler.jsonc` per deployable:

```
/apps
  /api              → API Worker (Hono, better-auth, all REST routes)
  /pipeline         → Workflows worker (GenerationPipeline, RegenerateScene, etc.)
  /render           → Render queue consumer + Container class + RenderJob DO
  /admin            → Admin Worker (static React assets + admin API)
/packages
  /db               → Drizzle schema + migrations (shared)
  /shared           → zod schemas, project-JSON types, token cost logic
  /remotion         → Existing Remotion compositions (Scene, TikTokCaption,
                      TransitionScene, VideoComposition) — reused as-is
/containers
  /renderer         → Dockerfile: node + chromium + @remotion/renderer + render server
```

- **Environments:** `dev` (local via `wrangler dev` + Miniflare), `staging`, `prod` — separate D1/R2/KV/Queues per env via wrangler `env` blocks.
- **CI/CD:** GitHub Actions → `wrangler deploy` per app; D1 migrations via `wrangler d1 migrations apply` gated on staging first.
- **Secrets:** Secrets Store / `wrangler secret` — OPENAI_API_KEY, GEMINI_API_KEY, REPLICATE_API_TOKEN, FCM service account, email key.

---

## 3. Data Layer

### D1 schema (port of existing Drizzle schema, SQLite dialect)

Existing tables carry over nearly 1:1 — `user`, `session`, `account`,
`verification` (better-auth), `projects`, `token_transactions`, `token_costs`,
`notifications`, `render_jobs`, `settings`. Changes:

- `user`: + `phone`, keep `tokens`, `isAdmin`
- `devices` (NEW): userId, fcmToken, platform, lastSeenAt
- `brands` (NEW): userId, name, logoUrl (Images ID), colors, font, phone, website, watermark
- `templates` (NEW): vertical, name, previewVideoUrl, scriptPromptPreset, imageStylePreset, musicTrackUrl, captionStyle, defaultDuration, isActive
- `projects`: + `templateId`, `brandId`, `schemaVersion`; scenes/composition/captionConfig stay JSON columns (the editing document)
- Timestamps become `integer` (unix ms) — SQLite has no native timestamp
- All IDs stay `text` (nanoid) — no serial; `render_jobs.id` → text

**D1 fit check:** ~10 GB per DB limit, reads are fast, writes serialized per DB —
fine for this workload (low write volume: project saves, token ledger).
Token deduction must be a single batched transaction (`db.batch([...])`) —
check balance + deduct + insert transaction row atomically to prevent
double-spend on concurrent requests.

### KV
- `templates:v{n}` — cached template list (app reads on launch)
- `settings` — system settings cache (backed by D1)
- better-auth secondary storage (session lookups at edge speed)
- `costs` — token cost table cache

### R2 buckets
- `assets` — voiceovers, generated images, music library (public via custom domain + Cache)
- `renders` — output MP4s (presigned GET, lifecycle rule: delete after 30–90 days)
- `uploads` — user-uploaded raw files (input to Cloudflare Images)

### Cloudflare Images
- User photo uploads and brand logos: direct creator upload URLs from the app,
  variants for thumbnail/editor/full — replaces hand-rolled resize logic.

---

## 4. Rendering on Containers (the critical path)

### Design

- **Image:** `containers/renderer/Dockerfile` — Node 22 + headless Chromium +
  `@remotion/renderer` + the bundled Remotion project (compositions copied from
  the existing repo). Runs a tiny HTTP server: `POST /render` with project JSON.
- **Instance type:** `standard-4` (4 vCPU, 12 GiB, 20 GB disk). A 30–60s
  1080p30 render is CPU-bound; 4 vCPU is the max — benchmark early (§8 Phase 0).
- **Routing:** one render job = one container instance:
  `env.RENDERER.getByName(jobId)` — job isolation, no cross-job interference.
  `sleepAfter = "10m"` so instances die after finishing.
- **Flow:**
  1. API validates tokens → inserts `render_jobs` row → enqueues `{jobId}` on `render-queue`
  2. Queue consumer worker picks up, calls Container DO `startAndWaitForPorts()`, POSTs project JSON
  3. Renderer streams progress callbacks (`onProgress`) → consumer updates **RenderJob DO** (live state) and D1 (durable state)
  4. Renderer uploads MP4 to R2 (S3 API from inside container, `enableInternet = true`)
  5. Consumer marks job complete → notification row + FCM push + email
- **Progress to app:** poll `GET /render-jobs/:id` (reads RenderJob DO) or
  WebSocket to the DO for live progress bar.
- **Concurrency control:** `max_instances` caps parallel renders; Queues
  `max_concurrency` on the consumer matches it; excess jobs wait in queue
  (honest "queued" state in UI). Queue retries + DLQ for failed renders.

### Risks & mitigations

- **Containers is beta** (no SLA, API drift). Mitigation: keep the Remotion
  Lambda path behind a `RENDER_BACKEND` flag during migration — the render
  consumer can dispatch to Lambda instead of Containers. Cut over only after
  ≥97% success rate over 2 weeks on staging + shadow traffic.
- **Render speed:** Lambda parallelizes across many lambdas; a single 4-vCPU
  container is slower (est. 2–5× realtime for 1080p — must benchmark).
  Acceptable if a 60s video renders in ~3–5 min with honest progress UI.
  If not: split render into chunks across N containers and concat (FFmpeg) —
  Phase 2 optimization, mirrors Remotion Lambda's own chunking model.
- **Cold start** 2–3s is negligible vs render time.
- **Disk is ephemeral** — fine; renders are stateless, output goes to R2.

---

## 5. Generation Pipeline on Workflows

One Workflow class `GenerationPipeline`, triggered by `POST /projects/:id/generate`:

```
step.do('deduct-tokens')            // D1 batch txn; fail fast if insufficient
step.do('generate-script')          // AI Gateway → GPT-4o-mini, fallback Gemini Flash
step.do('generate-voiceover')       // OpenAI TTS / Gemini TTS → R2
step.do('generate-timestamps')      // Whisper (via Replicate or OpenAI) — word-level
step.do('build-scenes')             // LLM scene split + image prompts
Promise.all(scenes.map(s =>
  step.do(`image-${s.id}`)))        // Replicate Flux-Schnell, parallel, per-scene retry
step.do('assemble-project-json')    // write composition JSON → D1 project row
step.do('notify')                   // FCM: "your video draft is ready"
```

Why Workflows (vs chaining in a Worker or Trigger.dev):
- Each step independently retried with backoff — a failed image doesn't rerun TTS.
- State persists across provider outages; instance survives for hours if needed.
- Replaces Trigger.dev entirely (one less vendor).
- Per-scene image steps give exactly the "one failed image ≠ failed project"
  behavior: catch per-step failure, mark scene `imageStatus: failed`, continue.

Smaller workflows: `RegenerateSceneImage`, `RegenerateVoiceover`,
`CloneScriptFromVideo` (existing Gemini feature). Refunds on hard failure:
compensating token credit in a final `step.do` catch.

**AI Gateway** fronts every provider call: unified logging, per-provider spend,
response caching (voice samples, repeated prompts), automatic fallback routing
(OpenAI → Gemini on 5xx/timeout), and rate-limit smoothing.

**Workers AI (optional cost tier):** free-tier users get Workers AI models
(Llama for scripts, Flux variants for images) at near-zero marginal cost;
paid tokens buy the premium providers. This is a genuine advantage of the CF
stack — decide per-vertical after quality checks.

---

## 6. API Surface (API Worker, Hono)

`/api/v1/...`, Bearer session tokens (better-auth), zod validation from `packages/shared`.

- **Auth:** signup/login (email+password, Google, phone-OTP later), session refresh
- **Projects:** CRUD, `POST /:id/generate` (starts Workflow, returns workflowInstanceId), `GET /:id/generation-status` (Workflow instance status), autosave `PATCH /:id/composition`
- **Assets:** presigned R2 upload/download URLs; Images direct-upload URLs
- **Render:** `POST /:id/render` (720p/1080p), `GET /render-jobs/:id`, WebSocket upgrade → RenderJob DO
- **Tokens:** balance, history, `GET /cost-estimate?templateId&duration`, Play Billing purchase verification (server-side receipt validation) → credit tokens
- **Templates/Brands:** list templates (KV-cached), brand CRUD
- **Notifications:** list, mark-read; device token registration
- **Admin (separate worker, isAdmin-gated):** users, token grants, cost table editor, settings, job monitor, template editor

Rate limiting: Workers Rate Limiting binding per-user on generation endpoints;
Turnstile on signup.

---

## 7. Migration Plan (from current stack)

Data migration is one-time and small (early-stage product):

1. **Schema port:** rewrite `db/schema.js` for SQLite dialect; generate D1 migrations.
2. **Data export:** script: Neon → JSON → `wrangler d1 execute` batch inserts
   (users, accounts w/ password hashes — better-auth hashes port as-is,
   token ledger, projects JSON, settings). Announce a maintenance window;
   sessions are NOT migrated (users re-login once).
3. **Assets:** `rclone` S3 → R2 (S3-compatible both sides); rewrite stored URLs
   with a migration script (or serve old URLs via redirect Worker during transition).
4. **Render URLs in old notifications:** leave pointing at S3 until lifecycle expiry.
5. **DNS cutover:** api.domain.com → Worker; keep web app pointed at old stack
   until its own migration (web is out of scope for this rewrite phase — mobile
   talks only to the new API).

---

## 8. Phases & Timeline

**Phase 0 — De-risk (1–2 wks), do FIRST, in parallel:**
- [ ] Containers render spike: Dockerfile with Remotion + existing compositions,
      benchmark 30s/60s at 720p/1080p on standard-4. **Go/no-go gate** —
      if render time or beta stability is unacceptable, keep Remotion Lambda
      as the render backend (everything else still moves to CF) and revisit.
- [ ] Workflows spike: full generation chain against real providers for one template.
- [ ] better-auth on Workers + D1 spike: signup/login/session from a test client.

**Phase 1 — Core platform (3–4 wks):**
Monorepo scaffold, D1 schema + migrations, API worker (auth, projects, tokens,
templates, brands), R2 + Images wiring, KV caches, staging env, CI/CD.

**Phase 2 — Pipeline (2–3 wks):**
GenerationPipeline Workflow + AI Gateway + per-scene retry + refunds;
regenerate workflows; cost-estimate endpoint; Analytics Engine events per stage.

**Phase 3 — Rendering (3–4 wks):**
Renderer container hardening, queue consumer, RenderJob DO with WebSocket
progress, DLQ + stuck-job cron reaper, notifications (FCM + email),
`RENDER_BACKEND` flag with Lambda fallback; load test with concurrent renders.

**Phase 4 — Migration & cutover (1–2 wks):**
Data + asset migration scripts, staging rehearsal, shadow renders comparing
Lambda vs Container output, maintenance-window cutover, 2-week Lambda fallback
retention, then decommission AWS (Lambda, S3, SQS) and Neon + Trigger.dev.

**Phase 5 — Admin & polish (2 wks):**
Admin worker (users/tokens/costs/jobs/templates), Turnstile, rate limits,
observability dashboards (Workers Logs + Analytics Engine), runbooks.

Total: **~12–16 weeks** with the Containers gate deciding the render path at week 2.

---

## 9. Cost Model (verify against current pricing before launch)

- Workers Paid plan ($5/mo base) covers Workers/KV/D1/Queues/Workflows at this scale — request/row pricing is negligible next to AI + render costs.
- R2: zero egress — meaningful saving vs S3 for video downloads.
- Containers: billed per active vCPU-second/GiB-second — you pay only while
  rendering. Compare directly against current Remotion Lambda bill in Phase 0.
- AI Gateway: gives per-provider spend attribution → true cost-per-video metric.
- Biggest line items remain OpenAI/Gemini/Replicate — unchanged by this rewrite.

## 10. Build Checklist (implementation status)

- [x] Monorepo scaffold + shared contracts (`packages/db`, `packages/shared`, CONTRACTS.md)
- [x] `apps/api` — API Worker: Hono, better-auth (D1+KV), projects/tokens/templates/brands/notifications/render routes, R2 presign, wrangler config
- [x] `apps/pipeline` — Workflows: GenerationPipeline (script→TTS→timestamps→scenes→images), RegenerateSceneImage, RegenerateVoiceover, token deduct/refund, AI Gateway calls
- [x] `apps/render` — Queue consumer, RenderJob Durable Object (progress + WebSocket), Renderer Container class, `containers/renderer` Dockerfile + render server (Remotion)
- [x] `apps/admin` — Admin Worker: users, token grants, cost editor, settings, job monitor, template editor
- [x] `appplan/app` — Flutter app: auth, template picker, generate flow with progress, project list, editor screens, render + download/share (flutter analyze: 0 errors; tests pass)
- [x] D1 migrations generated (`packages/db/migrations/0000_init.sql`) + seed data (`packages/db/seed.sql`: settings, token costs, 3 launch templates)
- [x] Stuck-job reaper cron in `apps/render` (every 10 min, fails + refunds jobs idle >30 min)
- [x] Neon→D1 data migration script (`scripts/migrate-from-neon.mjs`)
- [x] Deploy runbook (`DEPLOY.md`: resources, AI Gateway, secrets, deploy order, migration, smoke test)

## 10b. Deployment Status (Gokulhansv@gmail.com account, 2026-07-07)

- [x] D1 `ai-video-db` created (42aede4d-4f0c-41da-86d0-4a2bce18d83a, APAC), migrated + seeded
- [x] KV `ai-video-kv` (5a5e2238fcc5423d8a9d3ec4dd94121f); R2 `assets`/`renders`/`uploads`; Queues `render-queue`/`render-dlq`
- [x] Workers deployed: https://pipeline.gokulhansv.workers.dev (3 workflows), https://render.gokulhansv.workers.dev (DO + consumer + cron), https://api.gokulhansv.workers.dev, https://admin.gokulhansv.workers.dev
- [x] BETTER_AUTH_SECRET set; smoke tests pass: signup → bearer → templates → balance → project create → cost estimate → voices
- [ ] Container image build+push: needs Docker Desktop, then `wrangler deploy` in apps/render (currently deployed with --containers-rollout=none)
- [ ] Secrets: OPENAI_API_KEY / GEMINI_API_KEY / REPLICATE_API_TOKEN (pipeline), FCM_SERVICE_ACCOUNT_JSON (pipeline+render), R2 S3 keys (api+render), GOOGLE_CLIENT_ID/SECRET, Play Billing SA
- [ ] Create AI Gateway `ai-video` in dashboard (URL already wired into configs)
- [ ] Flutter base URL → https://api.gokulhansv.workers.dev

## 11. Top Risks

| Risk | Mitigation |
|---|---|
| Containers beta instability / API changes | `RENDER_BACKEND` flag; Lambda fallback until 2 weeks of ≥97% success |
| Single-container render too slow at 1080p | Phase 0 benchmark gate; chunked multi-container render as fallback design |
| D1 write serialization under growth | Fine at MVP scale; if it binds, shard by moving hot state (render progress) into DOs — already done |
| better-auth Workers edge cases (OAuth callbacks, cookies vs tokens) | Phase 0 spike; mobile uses Bearer tokens which is the simpler path |
| Migration data loss | Rehearse full migration on staging; keep Neon read-only snapshot 30 days |
| Team learns 6 new primitives at once | Phases sequence one primitive at a time; spikes before commitment |

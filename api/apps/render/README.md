# apps/render

Render queue consumer + `RenderJobDO` Durable Object + `RendererContainer`
(Remotion renderer container class). Owns the entire render pipeline from
`render-queue` message to R2 upload, D1 update, and push notification.

## Pieces

- **`src/index.ts`** — Worker entrypoint. `fetch()` routes `/do/:jobId/*` to
  the job's `RenderJobDO` (this is what `apps/api`'s `RENDER_SERVICE` service
  binding calls for `GET /render-jobs/:id` and the WS proxy). `queue()`
  delegates to `src/consumer.ts`.
- **`src/do.ts`** — `RenderJobDO` (per-job live state + hibernatable
  WebSocket push) and `RendererContainer` (the `@cloudflare/containers`
  `Container` subclass wired to `containers/renderer`).
- **`src/consumer.ts`** — the actual render orchestration: load composition
  from D1, start the container, POST `/render`, poll `/progress/:jobId`,
  forward progress to the DO and D1, handle success (R2 URL, notification,
  FCM) and failure (refund tokens, notification, FCM).
- **`src/fcm.ts`** — dependency-free FCM HTTP v1 client (WebCrypto JWT signing
  + OAuth2 token exchange, no `firebase-admin`).

## Progress flow (app -> DO -> client)

```
apps/api                render worker (this app)              containers/renderer
   |                            |                                      |
   | enqueue {jobId,...}  ----> queue()                                |
   |                            | POST /init            -> RenderJobDO |
   |                            | update render_jobs=starting          |
   |                            | POST /progress(starting)-> RenderJobDO|
   |                            | RENDERER.getByName(jobId)             |
   |                            | .startAndWaitForPorts()               |
   |                            | POST /render (RenderRequest) -------->| renderMedia()
   |                            | poll GET /progress/:jobId <-----------| onProgress updates map
   |                            | forward -> POST /progress -> RenderJobDO (broadcasts to WS)
   |                            |                                       | upload MP4 -> R2
   |                            | poll returns {status:completed,videoUrl}
   |                            | update render_jobs=completed, videoUrl
   |                            | insert notifications row + FCM push
   |
   | GET /render-jobs/:id  ---> RENDER_SERVICE -> /do/:jobId/status -> RenderJobDO -> {status,progress,videoUrl}
   | GET /render-jobs/:id/ws -> RENDER_SERVICE -> /do/:jobId/ws -> RenderJobDO WS -> pushes RenderProgressMessage JSON
```

The client (Flutter app) can either poll `GET /render-jobs/:id` or open the
WebSocket for live push updates — both are served by the same `RenderJobDO`
state, so they're always consistent.

## Bindings (see `wrangler.jsonc`)

| Binding | Type |
|---|---|
| `DB` | D1 (`ai-video-db`) |
| `ASSETS_BUCKET` / `RENDERS_BUCKET` | R2 |
| `RENDER_JOB_DO` | Durable Object `RenderJobDO` |
| `RENDERER` | Container `RendererContainer` (image `../../containers/renderer`) |

Queue consumer: `render-queue`, `max_concurrency: 5` (matches
`containers[0].max_instances`), `max_retries: 3`, DLQ `render-dlq`.

## Secrets / env vars

Set with `wrangler secret put <NAME>`:

- `FCM_SERVICE_ACCOUNT_JSON` — full Firebase service-account JSON.
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` — R2
  S3-compatible API credentials. These are **not** Worker bindings; they're
  forwarded into the `RendererContainer`'s `envVars` because the container
  runtime can't see Worker R2 bindings and must talk to R2 over its
  S3-compatible HTTP API directly.
- `R2_RENDERS_BUCKET_NAME` (plain var, defaults to `"renders"`) — bucket name
  as seen by the S3-compatible API (may differ from the Worker binding name).

## Deploy

```sh
pnpm install
wrangler d1 execute ai-video-db --remote --command "select 1" # sanity check binding
wrangler secret put FCM_SERVICE_ACCOUNT_JSON
wrangler secret put R2_ACCOUNT_ID
wrangler secret put R2_ACCESS_KEY_ID
wrangler secret put R2_SECRET_ACCESS_KEY
wrangler deploy
```

The container image is built and pushed automatically by `wrangler deploy`
from `containers/renderer/Dockerfile` (relative path resolved from this
app's `wrangler.jsonc`).

## Retry / DLQ semantics

- **Setup phase** (parse message, load + validate composition, init DO) —
  transient failures call `message.retry()` (up to `max_retries: 3`, then the
  queue's `dead_letter_queue: render-dlq` catches it automatically).
- **Render phase** (after the container accepted `POST /render`) — any
  failure here is terminal: we mark the job failed, refund the render token
  cost (`db.batch` credit + `token_transactions` insert per CONTRACTS.md),
  insert a `render_failed` notification, send FCM, then `message.ack()`.
  Retrying a committed render risks double-charging or duplicate output, so
  it's intentionally not retried automatically — the user re-triggers a
  render from the app instead.

## TODOs / deviations

- No deviations from CONTRACTS.md / Cloudflare_Rewrite_Plan.md §4.
- TODO: chunked multi-container rendering (plan §4 "Risks & mitigations") is
  out of scope here — single container per job, as specified.
- TODO: `RENDER_BACKEND` flag (Lambda fallback) mentioned in the plan is an
  `apps/api` concern (which backend enqueues to); not implemented in this
  worker.
- TODO: tune `POLL_INTERVAL_MS` / `MAX_WAIT_MS` in `src/consumer.ts` against
  real benchmark numbers from the Phase 0 render spike.
- A cron-triggered stuck-job reaper runs every ten minutes. It claims jobs
  left in `queued` or `rendering` for more than thirty minutes, marks them
  failed, refunds the recorded charge exactly once, updates the progress DO,
  and emits the normal failure notification.

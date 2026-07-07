# @app/admin

Cloudflare Worker serving the internal admin dashboard: a Hono API under
`/api/admin/*` plus a static, build-step-free vanilla JS single-page app.

## Auth model

There is no dependency on the `better-auth` library here. Every protected
route (everything except `GET /api/admin/config`) is guarded by
`src/middleware/auth.ts`, which:

1. Reads `Authorization: Bearer <token>`.
2. Looks up `session` by `token` in D1, joined to `user`.
3. Rejects if the session is missing/expired, or if `user.isAdmin` is false.

The dashboard's login screen either accepts a pasted bearer token directly,
or calls the main api's better-auth `/sign-in/email` endpoint (URL supplied
by `GET /api/admin/config`, which reads the `AUTH_API_URL` var) and extracts
the token from the `set-auth-token` response header or JSON body.

## Endpoints (`/api/admin/*`)

| Method & path | Notes |
|---|---|
| `GET /config` | Public. Returns `{ authApiUrl }` for the login screen. |
| `GET /stats` | User count, project count, render jobs by status, tokens spent in the last 30 days. |
| `GET /users` | `?search=&page=&pageSize=` |
| `POST /users/:id/grant-tokens` | `{ amount, description }`. Atomic `db.batch` credit + `admin_grant` transaction row. `amount` may be negative to deduct. |
| `POST /users/:id/toggle-admin` | `{ isAdmin }` |
| `GET /transactions` | `?userId=&type=&page=&pageSize=` |
| `GET /token-costs` | List all cost rows. |
| `PUT /token-costs/:action` | Upsert `{ cost, description?, isActive? }`. Busts KV key `costs`. |
| `GET /settings` | Auto-creates the `system` row on first read. |
| `PUT /settings` | Partial update. Busts KV key `settings`. |
| `GET /render-jobs` | `?status=&page=&pageSize=` |
| `GET /templates`, `GET /templates/:id` | List / read. |
| `POST /templates`, `PUT /templates/:id`, `DELETE /templates/:id` | Busts KV key `templates:v1`. |

All responses use the shared envelope from `@app/shared`: `{ data }` on
success, `{ error: { code, message } }` with the matching HTTP status on
failure.

## Static dashboard

`static/index.html` + `static/app.js` — no bundler, no framework. Tabs for
Stats, Users, Transactions, Token costs, Settings, Render jobs, Templates.
The bearer token is kept in `localStorage`; a 401 from any call clears it
and returns to the login screen.

## Config

- `wrangler.jsonc` bindings: `DB` (D1 `ai-video-db`), `KV`, static assets
  from `./static` with `run_worker_first: ["/api/*"]` so the worker handles
  API routes while everything else is served as a static asset.
- `vars.AUTH_API_URL`: base URL of the main api worker's better-auth mount
  (e.g. `https://api.<domain>/api/auth`), used only by `GET /config`.

## Deploy

```sh
pnpm install
# fill in database_id / KV id in wrangler.jsonc, and AUTH_API_URL
pnpm --filter @app/admin typecheck
pnpm --filter @app/admin deploy
```

## TODOs / follow-ups

- No rate limiting on `GET /config` or the auth-check path — fine for an
  internal tool, but consider adding Cloudflare WAF/Access in front of the
  worker's static routes for defense in depth.
- `POST /users/:id/grant-tokens` does not enforce `settings.maxTokensPerUser`;
  add a clamp/validation if that ceiling should be hard-enforced from here.
- No audit log dedicated to admin actions beyond the `token_transactions`
  rows the grant endpoint writes; toggling `isAdmin` and template/cost edits
  aren't currently recorded anywhere.
- Sign-in-with-password flow assumes better-auth's default bearer-token
  response shape (`set-auth-token` header or `token` field); verify against
  the actual `apps/api` auth config once it lands, since `apps/api/src` is
  still being built out.

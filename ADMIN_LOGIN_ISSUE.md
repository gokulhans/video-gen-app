# Admin Panel Login Issue

## Affected URL

https://admin.gokulhansv.workers.dev

## Symptoms

The admin panel initially reported:

- CORS failure when calling `https://api.gokulhansv.workers.dev/api/auth/sign-in/email`.
- `403 Invalid origin` from Better Auth.
- After those fixes, `/api/admin/me` returned `401 Invalid or expired session`.
- Chrome DevTools also showed a harmless `favicon.ico` `404`.

## Account

The account `admin@gmail.com` exists in production D1 and is marked as an administrator (`is_admin = 1`). No passwords or bearer tokens are stored in this document.

## Root Causes

1. The API CORS allowlist initially included the Aividgen app origin but not the admin origin.
2. Better Auth did not have the admin origin configured as a trusted origin.
3. The admin Worker attempted to validate sessions directly against D1's `session` table, while the API uses Better Auth secondary storage through KV. The D1 session table therefore contained no usable admin sessions.
4. The admin frontend needed Better Auth's `set-auth-token` response header exposed to the browser.

## Changes Deployed

- Added `https://admin.gokulhansv.workers.dev` to API `ALLOWED_ORIGINS`.
- Added Better Auth `trustedOrigins` derived from `ALLOWED_ORIGINS`.
- Exposed the `set-auth-token` response header through API CORS.
- Updated admin authentication to validate bearer tokens through the API Worker's Better Auth `/get-session` endpoint, then resolve admin/RBAC permissions from D1.
- Typechecked and redeployed the API and admin Workers.

## Current Troubleshooting

If Chrome still displays “Session expired, please sign in again”:

1. Open DevTools Console on the admin panel.
2. Clear the stale admin token:

   ```js
   localStorage.removeItem("admin_bearer_token");
   location.reload();
   ```

3. Sign in again.
4. If it still fails, inspect the Network request for `sign-in/email` and record only its HTTP status and non-sensitive error message. Do not share passwords or bearer tokens.

## Verification

The API responds with:

- `Access-Control-Allow-Origin: https://admin.gokulhansv.workers.dev`
- `Access-Control-Expose-Headers: x-request-id,set-auth-token`

The admin Worker typecheck and Wrangler deployment dry run passed.

## Related Files

- `api/apps/api/src/index.ts`
- `api/apps/api/src/lib/auth.ts`
- `api/apps/api/wrangler.jsonc`
- `api/apps/admin/src/middleware/auth.ts`
- `api/apps/admin/static/app.js`
- `api/apps/admin/wrangler.jsonc`

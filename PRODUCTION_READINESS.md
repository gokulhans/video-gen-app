# Production readiness checklist

The code paths and contracts are now aligned, but deployment still requires environment-specific provisioning:

1. Apply the complete ordered D1 migration set (`0000` through the latest
   journal entry, currently `0007_play_purchase_acknowledgement.sql`) to the
   isolated staging database first, then production.
2. Set all Worker secrets with Wrangler. At minimum: `OPENAI_API_KEY`, `GEMINI_API_KEY`, `REPLICATE_API_TOKEN`, `BETTER_AUTH_SECRET`, Google OAuth/Play credentials, FCM service-account JSON, and the R2 S3 credentials used for presigned URLs and the renderer container.
3. Set `ALLOWED_ORIGINS` to the exact Cloudflare static-app/admin origins for
   the target environment; never use a wildcard.
4. Keep `PLAY_TOKEN_PACKS_JSON` server-owned and synchronized with Play Console product IDs. The client no longer supplies token amounts.
5. Deploy the renderer with Docker available. The Worker dry-run is validated with `--containers-rollout=none`, but the image itself must still be built and scanned in CI.
6. Configure a real Android application ID/release signing key and iOS bundle ID/entitlements before store release. The repository’s existing Firebase files are environment-specific and must be checked against those identifiers.
7. Deploy in this order: D1 migration, pipeline, render, API, admin, then the
   Flutter static Worker. Verify health, a one-second P-Video smoke, a test
   render, a failed/refunded job, export/download, account deletion cooling-off,
   and a replayed purchase in staging before production.

The default economical video path is the pinned Replicate
`prunaai/p-video` digest recorded in the admin rules and seed data. Test mode is
fixed to one second, 720p, draft rendering, and no audio. Provider credentials,
Google Play acknowledgement, Firebase push, and Apple billing remain
environment/store integrations; none of those secrets or paid calls belong in
source control. Use [`docs/production-runbook.md`](docs/production-runbook.md)
and [`docs/staging-provisioning.md`](docs/staging-provisioning.md) as the
release authority.

# Production readiness checklist

The code paths and contracts are now aligned, but deployment still requires environment-specific provisioning:

1. Apply `api/packages/db/migrations/0001_production_hardening.sql` to the remote D1 database before deploying API, pipeline, render, or admin.
2. Set all Worker secrets with Wrangler. At minimum: `OPENAI_API_KEY`, `GEMINI_API_KEY`, `REPLICATE_API_TOKEN`, `BETTER_AUTH_SECRET`, Google OAuth/Play credentials, FCM service-account JSON, and the R2 S3 credentials used for presigned URLs and the renderer container.
3. Set `ALLOWED_ORIGINS` to the exact browser/admin origins. It is intentionally empty in the checked-in config.
4. Keep `PLAY_TOKEN_PACKS_JSON` server-owned and synchronized with Play Console product IDs. The client no longer supplies token amounts.
5. Deploy the renderer with Docker available. The Worker dry-run is validated with `--containers-rollout=none`, but the image itself must still be built and scanned in CI.
6. Configure a real Android application ID/release signing key and iOS bundle ID/entitlements before store release. The repository’s existing Firebase files are environment-specific and must be checked against those identifiers.
7. Deploy in this order: D1 migration, pipeline, API, render, admin. Verify health, a test generation, a test render, a failed/refunded job, and a replayed purchase in staging before production.

Replicate integration uses the official `black-forest-labs/flux-schnell` model endpoint, `Prefer: wait`, `Cancel-After`, adaptive polling, prediction cancellation, authenticated `replicate.delivery` downloads, strict output validation, and four-image workflow concurrency. The previous `openai/whisper` fallback was removed because its current public-model schema does not guarantee word timestamps; OpenAI Whisper remains the schema-validated timestamp source until a pinned Replicate timestamp model is fixture-tested.

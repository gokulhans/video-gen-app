# Production deployment and recovery runbook

This runbook is the release authority for the Cloudflare stack. Commands are
examples: substitute the environment-specific config, Worker names, database,
and bucket names. Never test a staging release against production bindings.

## Required environment isolation

Create independent `staging` and `production` resources for D1, KV, R2,
Queues/DLQs, Stream libraries, Workers, Workflows, Durable Objects, Containers,
AI Gateway, Firebase, Google OAuth/Play, and Replicate credentials. Use distinct
Worker names and hostnames (`*-staging`), and distinct R2 API tokens restricted
to the three buckets in that environment. A staging API must never bind the
production D1 database, Stream library, queue, or R2 bucket.

The committed Wrangler files currently identify one live resource set and do
not yet define named staging/production environments. Before the first staging
deployment, add environment-specific IDs and names to every Worker config and
verify that no staging binding ID equals its production counterpart. Real
staging D1/KV/R2/Queue/Stream identifiers are an external provisioning gap.

## Secrets and non-secret variables

Set secrets interactively with `wrangler secret put`; never pass values on the
command line or commit `.dev.vars`.

- API: `BETTER_AUTH_SECRET`, R2 account/access credentials, Google OAuth/Play
  credentials, and `MEDIA_INGEST_SIGNING_SECRET`.
- Pipeline: OpenAI, Gemini, Replicate, FCM credentials, and the exact same
  `MEDIA_INGEST_SIGNING_SECRET` as the API Worker.
- Render: environment-scoped R2 credentials and FCM credentials.
- GitHub production environments: environment-scoped `CLOUDFLARE_API_TOKEN`.
- GitHub `paid-smoke` environment: a restricted `REPLICATE_API_TOKEN`; require
  reviewer approval and configure a provider-side spend limit.

`STREAM_CUSTOMER_CODE` is non-secret but environment-specific. Read it from the
matching Stream dashboard. `APP_BASE_URL`, auth URLs, AI Gateway URLs, allowed
origins, Android Firebase configuration, and Flutter `--dart-define` values must
also point to the same environment.

## Release gates

The CI workflow must pass Node typechecks/tests, admin/container syntax checks,
local D1 migrations plus seed and `foreign_key_check`, all Worker dry-runs,
generated binding checks, Flutter format/analyze/tests/debug build, dependency
audit, and secret scanning. Dry-runs are local bundle validation and require no
production secrets.

## Staging to production order

1. Record the Git SHA, active Worker version IDs, D1 migration list, queue
   depth, Workflow failures, and current error rate.
2. Export D1 before any schema or seed mutation:
   `pnpm exec wrangler d1 export <staging-db> --remote --output backups/staging-<UTC>.sql`.
   Store the encrypted export outside the repository and verify it is nonempty.
3. Apply additive/backward-compatible D1 migrations to staging, then run seed
   and `PRAGMA foreign_key_check`. Never delete/rename a column in the same
   release that stops writing it.
4. Deploy pipeline first, render second, API third, and admin last. This ensures
   service/Workflow bindings target compatible code before callers expose it.
5. Run auth/catalog/upload tests with free operations. Run the paid smoke only
   when explicitly approved as described below.
6. Soak staging and inspect Worker errors, Workflow status, queue/DLQ depth,
   Stream failures, credit ledger reconciliation, and R2 object creation.
7. Repeat the D1 export and the same order in production. Prefer gradual Worker
   deployments for HTTP-facing API/admin changes. Do not gradually split code
   that relies on an incompatible schema or Durable Object migration.
8. Build Flutter with production `dart-define` values only after backend smoke
   checks pass. Retain the previous signed app artifact.

## Rollback and data restore

For a code-only regression, stop the rollout and use `wrangler deployments
status`, then `wrangler rollback <VERSION_ID> --message "incident <id>"` in
reverse caller order: admin, API, render, pipeline. A Worker rollback is not a
database rollback and can be refused if a bound resource was removed.

For schema/data damage, disable writes or maintenance jobs, export the damaged
database for forensics, and restore the verified pre-release SQL export into a
new D1 database. Validate `foreign_key_check` and row counts, update all
environment bindings to the restored database, dry-run, then deploy in the
normal dependency order. Prefer a forward repair migration when data written
after the release must be preserved. Never import a backup blindly over the
only production database.

R2 objects are not rolled back with Worker code. Preserve app-owned masters and
renders through an incident. Restore missing objects from an independent copy,
then reconcile D1 asset records; do not point D1 at provider-temporary URLs.

## R2 lifecycle policy

Apply lifecycle rules independently per environment and prefix. Abort incomplete
multipart uploads after one day. A short expiry is suitable only for a dedicated
temporary prefix. Do not apply blanket expiry to `users/*/generation-jobs/*`
masters or completed renders: deletion must follow the documented customer
retention/account-deletion policy and a D1 tombstone/audit record. The current
key layout does not isolate all pending/rejected uploads into a disposable
prefix, so aggressive automatic deletion is a follow-up rather than a safe
launch setting. Test lifecycle rules in staging and audit their prefix filters.

## Paid Replicate smoke

The `Paid Replicate smoke (manual)` workflow is the only CI path authorized to
make a paid inference call. It requires the exact confirmation text, protected
`paid-smoke` environment approval, a maximum operator acknowledgment of USD
0.01, a one-second 720p draft, pinned model version, fixed seed, safety enabled,
no audio, no create retry, and an automatic provider cancellation deadline.
The script validates the guard before reading the token or calling Replicate.
Provider-side spend limits remain mandatory because a client-side limit cannot
guarantee provider billing.

This is a provider-adapter smoke only. It does not prove the authenticated
quote → credit reservation → Workflow → R2 → Stream application path. Run that
full E2E flow separately in staging with a dedicated test tenant and the same
operator/provider budget controls.

## Scheduled reconciler decision

No mutating generation reconciler is enabled. The current data model cannot
distinguish a genuinely abandoned job/asset from a slow or replaying Workflow:
there is no workflow lease/heartbeat, and an FCM send can succeed before
`push_sent` is persisted. Automatically refunding expired reservations,
deleting pending assets, or resending notifications could therefore corrupt
credits, interfere with active work, or duplicate pushes.

Before enabling a cron, add and deploy:

1. `generation_jobs.workflow_heartbeat_at`, `lease_owner`, `lease_expires_at`,
   and a monotonic workflow epoch renewed by every durable phase.
2. A unique reconciliation claim/operation key and an atomic settlement
   procedure that checks the same epoch and reservation state.
3. Asset `ingest_started_at`, `last_checked_at`, and terminal provider status;
   never delete an R2 master merely because Stream playback is pending.
4. Notification delivery-attempt IDs, retry count/backoff, next-attempt time,
   and a provider idempotency mechanism or an accepted duplicate policy.
5. Read-only audit mode, strict age thresholds, fixed batch limits, structured
   metrics, and an operator kill switch. Soak audit mode in staging before
   enabling mutation.

Until then, investigate with bounded read-only D1 queries and Workflow/Queue
dashboards. Resolve individual records through an incident-reviewed script with
an immutable operation key, never an ad hoc broad update.

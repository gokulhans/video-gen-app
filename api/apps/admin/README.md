# @app/admin

Cloudflare Worker control plane: Hono APIs under `/api/admin/*` plus a build-step-free static operations console.

## Security perimeter

- Put the entire deployment behind Cloudflare Access. This Worker deliberately does not pretend to verify Access headers.
- Protected routes also validate the existing bearer session in D1.
- RBAC is resolved from `admin_roles` / `admin_user_roles`. The Users console assigns the seeded catalog-manager, safety-reviewer, and support-analyst roles with an atomic audit event; `user.isAdmin` remains an emergency super-admin fallback.
- Role permissions are server-enforced. The static UI is not an authorization boundary.
- Provider credentials belong in Worker secrets and never in D1, KV, source, logs, or the UI.
- Compatibility login currently keeps its bearer token in `localStorage`. Restrict operators through Access and replace this with an HttpOnly session before broad rollout.

## Control-plane modules

- Categories: ordered, active catalog groupings.
- Templates: draft versions, restricted input definitions, provider bindings, validated immutable publishing, and archival without hard deletion.
- Providers/models: public capability and cost metadata. `replicate / prunaai/p-video` is visibly pinned as the economical test default.
- Pricing: append-only drafts and immutable published versions.
- Voices and stock characters: activation plus sample/preview, consent, and license metadata.
- Generation operations: read-only jobs, attempts, events, assets, and credit reservations. There is intentionally no paid retry action.
- Audit: sanitized immutable records for every new privileged mutation.
- Legacy users, transactions, token costs, settings, and render jobs remain available behind `legacy.read` / `legacy.write`.

Published catalog mutations replace the KV `catalog:version` marker with a unique value and clear the legacy `templates:v1` entry. D1 remains the source of truth.

The pinned five-credit P-Video test template is intentionally limited to one second, 720p, and no audio. Higher-cost combinations require a separately priced production template; both admin publication validation and the generation API reject attempts to smuggle them into test mode.

## Permission keys

`catalog.read`, `catalog.write`, `catalog.publish`, `providers.read`, `providers.write`, `providers.publish`, `pricing.read`, `pricing.write`, `pricing.publish`, `voices.read`, `voices.write`, `characters.read`, `characters.write`, `characters.moderate`, `jobs.read`, `audit.read`, `legacy.read`, `legacy.write`. A role containing `*` grants all permissions.

## Verification

```sh
npm run typecheck
npm test
npm run check:static
npx wrangler deploy --dry-run
```

Run `npx wrangler types` after any binding change; generated bindings live in `worker-configuration.d.ts`.

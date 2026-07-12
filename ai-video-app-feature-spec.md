# Production plan: scalable AI video platform for businesses

## 1. Purpose

Build a production-grade AI video generation platform for business owners. Users discover business-specific templates, enter a short brief or script, select a presenter and voice when supported, and receive a finished video after cloud generation.

This plan extends the implementation already present in this repository. It must not create a third parallel architecture or rebuild capabilities that already exist.

The product consists of:

- A Flutter client for Android, iOS, and optionally web/desktop.
- A Cloudflare-hosted API and background-processing platform.
- A Cloudflare-hosted admin control plane.
- Configurable AI generation providers selected per template and template version.
- Durable Cloudflare-owned storage and delivery for all user and generated assets.

The platform is for business marketing and sales videos, not a general-purpose creator tool. Product choices should optimize for speed, repeatability, brand consistency, and simple business outcomes.

---

## 2. Existing implementation: preserve and extend

Before changing code, inspect and preserve the conventions in the active `appplan` implementation:

- `app/`: Flutter app using Riverpod, GoRouter, repository classes, Firebase Messaging, and feature-based folders.
- `api/apps/api/`: public Cloudflare Worker API using Hono and Zod.
- `api/apps/pipeline/`: Cloudflare Workflows generation orchestration and provider adapters.
- `api/apps/render/`: Cloudflare Queue consumer, Durable Object job state, and renderer integration.
- `api/apps/admin/`: existing admin Worker and static admin application.
- `api/containers/renderer/`: Remotion renderer running in Cloudflare Containers.
- `api/packages/db/`: shared Drizzle/D1 schema and migrations.
- `api/packages/shared/`: shared schemas and cross-service contracts.

Existing capabilities include Better Auth, D1, R2, KV, token accounting, template APIs, notifications, FCM device registration, generation workflows, render jobs, an admin area, and a Flutter creation/editor flow. Extend these capabilities through migrations and versioned contracts. Do not replace them with duplicate services.

The older Next.js/Neon/Trigger.dev/Remotion Lambda implementation in the parent repository is a migration source and fallback reference, not the target architecture for new features.

### Mandatory pre-implementation audit

Before Phase 1, document:

- Which Cloudflare environments are live: local, development, staging, and production.
- Which D1 migrations are applied in each environment.
- Which Workers, Queues, Workflows, Durable Objects, Containers, R2 buckets, Stream accounts, KV namespaces, domains, and secrets are provisioned.
- Whether the Cloudflare renderer image has been built and deployed successfully.
- Which existing app flows work against staging.
- Which legacy services still receive production traffic.
- Current generation success rate, render success rate, latency, and cost per completed video.

No feature phase begins until its dependencies and rollback path are known.

---

## 3. Cloudflare-first hosting boundary

All application infrastructure must live inside the Cloudflare ecosystem wherever Cloudflare provides the required primitive.

| Capability | Cloudflare service |
|---|---|
| Public API and webhook endpoints | Workers |
| Flutter web build and admin UI | Workers Static Assets |
| Authentication data and relational product data | D1 |
| Session/config/catalog cache | KV |
| Durable multi-stage generation | Workflows |
| Job dispatch, fan-out, and dead-letter handling | Queues |
| Per-job realtime state and WebSockets | Durable Objects |
| Remotion/FFmpeg rendering | Containers controlled by Workers |
| Source files and durable master outputs | R2 |
| Adaptive video playback and preview delivery | Stream |
| Image resizing and delivery | Cloudflare Images or R2 image transformations |
| AI provider routing and spend visibility | AI Gateway |
| Cloudflare-hosted inference where quality permits | Workers AI |
| Secrets | Workers Secrets or Secrets Store |
| Bot and signup abuse protection | Turnstile, WAF, and rate limiting |
| Logs and product/operational metrics | Workers Logs and Analytics Engine |
| Scheduled cleanup and reconciliation | Workflows schedules or Cron Triggers |
| DNS, TLS, CDN, cache, and access policies | Cloudflare DNS/CDN/Zero Trust |

### Honest external-service boundary

“Cloudflare-hosted” applies to the application, orchestration, data, files, rendering, security, and delivery. Some integrations necessarily remain external:

- Replicate, Kling, Veo, ElevenLabs, or other third-party model inference runs on that provider's infrastructure. Calls must originate from Cloudflare Workers/Workflows and pass through AI Gateway where supported.
- Android and iOS push delivery ultimately uses FCM and APNs. Cloudflare owns device registration, notification records, dispatch logic, retries, and auditing.
- Apple App Store and Google Play distribute native binaries and validate store purchases.

The provider layer must allow a template to use Workers AI instead of an external provider when its quality and capabilities are sufficient. No external provider may own the system of record or the only copy of a generated asset.

---

## 4. Product information architecture

### Client navigation

The authenticated app has exactly three primary tabs:

1. **Home**: personalized template discovery and generation entry.
2. **Character**: the user's presenters, brand characters, voices, and favorites.
3. **History**: all generation jobs and completed videos.

Secondary destinations live in a drawer or profile/settings flow:

- Profile and business information
- Brand kits
- Credits, subscription, and invoices
- Notification preferences
- Appearance and language
- Support and report a problem
- Privacy, terms, consent records, and account deletion
- Logout

### Entry flow

- Splash resolves local configuration, session, onboarding state, and minimum supported app version.
- First-time users see two or three onboarding screens and then authentication.
- Returning authenticated users go directly to the authenticated shell.
- Expired sessions return users to sign-in without losing an unsent local draft.
- Mandatory upgrade, maintenance, and degraded-service states are remotely controllable.

---

## 5. Admin control plane: required

An admin panel is required for a scalable product. Templates and model capabilities change too frequently to be safely hard-coded in the Flutter app. The existing `api/apps/admin` application must be expanded into the platform control plane and hosted as a separate Cloudflare Worker with static assets.

### Roles and access

Replace a single `isAdmin` check over time with role-based access control:

- **Super admin**: roles, secrets references, destructive actions, system configuration.
- **Content manager**: categories, templates, previews, voices, stock characters, localization.
- **Operations**: jobs, retries, refunds, provider incidents, queues, moderation.
- **Support**: users, entitlements, job timelines, approved credit adjustments.
- **Finance analyst**: prices, costs, margins, purchases, refunds, exports.
- **Read-only analyst**: dashboards and catalog visibility.

Every privileged mutation must write an immutable audit event containing actor, action, target, before/after summary, reason, timestamp, and request ID. Sensitive values and provider secrets must never appear in audit payloads.

### Admin modules

#### A. Categories and discovery

- Create and order business categories.
- Manage title, slug, icon, cover image, description, localization, active state, and SEO/deep-link metadata.
- Configure home-row placement, audience targeting, featured content, and scheduled publishing.

#### B. Template studio

- Create a draft template and publish immutable versions.
- Configure category, tags, business verticals, preview video, thumbnail, sample outputs, and supported locales.
- Configure required and optional form fields using a validated schema.
- Configure allowed durations, aspect ratios, resolutions, voices, characters, and brand inputs.
- Assign the generation pipeline, provider model version, renderer composition, credit price, and estimated provider cost.
- Validate a template with test inputs before publishing.
- Preview output in staging, schedule releases, roll back to an earlier version, archive, clone, and soft-delete.
- Roll out by percentage, platform, app version, locale, subscription tier, or internal test cohort.

Published template versions are immutable. Existing jobs must always retain the exact version and configuration snapshot used to generate them.

#### C. Provider and model registry

- Register providers such as Workers AI, Replicate, fal.ai, Kling, Veo, OpenAI, Gemini, and voice providers.
- Register pinned model identifiers/versions and capability metadata.
- Configure supported input types, duration/orientation/resolution constraints, timeout, concurrency class, retry policy, webhook mode, and output validator.
- Configure fallback chains only where output compatibility has been tested.
- Track active, degraded, disabled, and test-only states.
- Store safe configuration in D1; store credentials only in Cloudflare secrets and reference them by logical key.
- Show operational health, latency, success rate, and estimated versus actual cost by provider/model.

Changing a model never silently changes an already-published template version. Publish a new version and canary it.

#### D. Voice catalog

- Manage stock voice records, provider voice IDs, locale, accent, style, gender presentation, sample audio, tags, premium tier, active state, and ordering.
- Map compatible voices to templates and model versions.
- Generate or upload samples and verify their storage in R2/Stream before publishing.
- Disable a voice without breaking historical projects.

Users can favorite catalog voices. A future custom-voice feature must have a separate consent and verification workflow.

#### E. Stock character library

- Manage platform-owned presenters and backgrounds.
- Store licensing/consent status, permitted use, expiration, demographic tags, preview assets, compatible providers/models, and active state.
- Publish characters by locale, category, subscription tier, and region.

User-created characters are not created by admins. They remain private, user-owned resources. Admins may quarantine or review them only through a permissioned moderation/support workflow.

#### F. Music, captions, effects, and brand presets

- Manage licensed music tracks, caption presets, visual styles, transitions, backgrounds, and Remotion compositions.
- Record license source, allowed regions, expiry, attribution requirements, and allowed commercial usage.

#### G. Pricing and entitlement management

- Manage credit packs, subscription plans, feature entitlements, per-operation prices, promotional grants, and regional/store product mappings.
- Display estimated provider cost, render cost, total cost, selling price, and margin by template/version.
- Changes are versioned and never rewrite historical ledger entries.

#### H. Job operations

- Search jobs by user, project, template, provider prediction, workflow instance, status, or request ID.
- View a complete event timeline and redacted provider request/response metadata.
- Retry only retry-safe stages, cancel eligible jobs, replay webhooks idempotently, issue reasoned refunds, and quarantine suspicious outputs.
- Monitor queue depth, dead-letter jobs, stuck jobs, failure clusters, and provider incidents.

#### I. Users, moderation, support, and compliance

- View account status, plan, entitlements, credits, devices, consent records, flags, and recent jobs.
- Suspend generation, revoke sessions, initiate export/deletion, and process audited support adjustments.
- Review reported or automatically flagged assets without exposing them to unrelated staff.

#### J. Feature flags and system configuration

- Minimum app version, maintenance mode, provider kill switches, generation limits, catalog cache version, notification toggles, rollout cohorts, and retention settings.
- Dangerous configuration changes require confirmation and optionally two-person approval.

---

## 6. Catalog and versioned configuration model

The current `templates` table is a useful starting point but is not sufficient for multiple providers and production rollouts. Add normalized, versioned entities through forward-only D1 migrations.

Core catalog entities:

- `categories`
- `templates`
- `template_versions`
- `template_category_links`
- `template_assets`
- `template_input_definitions`
- `providers`
- `provider_models`
- `provider_model_versions`
- `template_pipeline_bindings`
- `voices`
- `voice_provider_bindings`
- `stock_characters`
- `stock_character_provider_bindings`
- `backgrounds`
- `music_tracks`
- `caption_presets`
- `feature_flags`
- `catalog_publications`
- `admin_audit_events`

### Template version contract

Every published template version must define:

- Stable template ID and immutable version ID.
- Display metadata and localized copy.
- Preview and thumbnail asset IDs.
- Business category and discovery tags.
- Input schema with labels, validation, defaults, and conditional visibility.
- Pipeline type, provider/model version, and provider input mapping.
- Supported duration, orientation, aspect ratio, resolution, and locale combinations.
- Character policy: none, optional, required, stock-only, or user-character allowed.
- Voice policy and compatible voice set.
- Renderer composition version and post-processing configuration.
- Safety policy and moderation requirements.
- Credit price version and internal cost-estimation rule.
- Rollout and availability rules.

The client must render forms from a restricted, versioned schema. It must never execute arbitrary code or receive provider secrets/provider-native payloads from the catalog.

### Catalog delivery

- D1 is the source of truth.
- Publishing produces a validated catalog snapshot.
- Public snapshots are cached in KV and at the edge using an explicit catalog version/ETag.
- The Flutter client caches the most recent valid snapshot for degraded/offline browsing.
- Generation always revalidates availability, price, and capabilities server-side.

---

## 7. User-owned characters, voices, and brand assets

### Character model

A user character is a versioned bundle, not just an image:

- Owner/user ID
- Name and optional business/brand association
- Source face assets
- Default background or transparent-background asset
- Provider-specific trained asset IDs or references
- Compatible model/version list
- Consent and rights declaration
- Moderation status
- Processing status and failure reason
- Version, created time, archived time, and deletion status

Never expose one user's character to another user. All database queries and object keys must be tenant-scoped.

### Character flow

1. Request a short-lived direct upload URL.
2. Upload directly to R2/Images without proxying large files through the API Worker.
3. Validate MIME type, magic bytes, dimensions, size, and malware/safety policy.
4. Record consent and commercial-use declaration.
5. Run background preparation/moderation through a Workflow.
6. Save a new immutable character version.
7. Display only `ready` and template-compatible characters in generation forms.

### Voice flow

Phase 1 supports curated stock voices and user favorites. Custom voice cloning is a separate, gated future phase requiring explicit recorded consent, anti-impersonation controls, regional policy checks, deletion handling, and provider capability review.

### Brand kits

Extend existing brands with versioned logos, colors, fonts, CTA text, phone, website, watermark rules, intro/outro assets, and default aspect ratios. Snapshot the selected brand version into every generation job so later brand edits do not alter historical videos.

---

## 8. Generation and rendering architecture

### Public request flow

1. Flutter requests a server-calculated quote for a selected template version and inputs.
2. API authenticates the user, validates tenant ownership, template availability, capabilities, abuse limits, subscription entitlement, and credits.
3. API creates an idempotent generation request and atomically reserves credits.
4. API snapshots template version, model version, pricing version, character version, voice binding, brand version, and normalized inputs.
5. API starts a Cloudflare Workflow and returns `202 Accepted` with a job ID immediately.
6. History displays the job without waiting for provider submission.
7. Workflow performs provider calls, waits for webhooks or polls when required, validates output, copies it into R2, performs post-processing/rendering, publishes the playable asset to Stream, and completes the job.
8. Completion writes an in-app notification and dispatches eligible push/email notifications.

### Provider abstraction

Use a provider interface with capabilities rather than provider-specific logic in routes or UI. A video provider should expose operations equivalent to:

- Validate normalized inputs against a pinned model version.
- Estimate cost and expected latency.
- Submit with an idempotency/correlation key.
- Resolve webhook events or poll status.
- Cancel when supported.
- Normalize progress and terminal output.
- Validate and download output.
- Classify errors as retryable, non-retryable, moderation, quota, or provider incident.

Equivalent interfaces should exist for image, voice, transcription, and rendering providers. Provider-native payloads remain inside adapter modules.

### Job state machine

Use explicit states and validated transitions:

`draft -> validating -> credit_reserved -> queued -> submitting -> provider_processing -> ingesting -> post_processing -> rendering -> publishing -> completed`

Terminal or exceptional states:

- `failed_retryable`
- `failed_terminal`
- `rejected_safety`
- `cancel_requested`
- `cancelled`
- `expired`

Do not infer the full job state from a project row. Introduce generation job, attempt, event, and asset records. Store a durable event timeline for debugging and customer support.

### Idempotency and webhook rules

- Require an idempotency key on every cost-bearing client request.
- Enforce database uniqueness for submission, charge, refund, purchase, and notification operations.
- Verify webhook authenticity using the provider's supported signing mechanism.
- Store a hash/ID for every accepted webhook event and ignore duplicates.
- Reject impossible or regressive state transitions.
- Correlate provider job IDs to internal attempts; never trust a user-supplied user/project ID in a webhook.
- Return quickly from the webhook Worker and continue heavy processing through a Queue or Workflow event.
- Reconciliation schedules inspect provider jobs that missed webhooks.

### Credits and billing

The existing token system becomes an append-only credit ledger with reservation semantics:

- Quote using a server-owned price version.
- Atomically reserve before external submission.
- Capture the appropriate amount according to product policy.
- Release or refund exactly once on eligible terminal failure/cancellation.
- Record adjustments as new entries; never edit ledger history.
- Reconcile ledger totals with cached user balance.
- Prevent concurrent overspending and replayed purchase receipts.

Separate user-facing price from provider cost. Persist estimated and actual internal cost per job for margin analysis.

### Asset ownership and delivery

- Provider URLs are temporary ingestion sources only.
- Download and validate completed provider output, then write the durable master to R2.
- Use deterministic tenant/job-scoped object keys and asset records.
- Publish completed playback versions to Stream for adaptive delivery and signed access.
- Store thumbnails/posters through Stream or Images.
- Downloads use short-lived signed URLs and authorization checks.
- Apply configurable retention by asset type, plan, legal hold, and account deletion state.
- Clean up incomplete multipart uploads, abandoned drafts, provider temp files, and expired derived assets through scheduled Workflows.

### Rendering

- Continue using Remotion in Cloudflare Containers behind the existing render Worker.
- Queue concurrency and container instance caps must be configurable by environment.
- A render job is idempotent and writes output to a unique R2 key.
- Durable Objects provide live progress but D1 remains the durable business record.
- Queue retries go to a dead-letter queue after bounded attempts.
- Maintain a renderer backend feature flag and rollback path until Cloudflare Container rendering meets the production success and latency gates.

---

## 9. Client feature requirements

### Home and template discovery

- Approximately eight initial business-category rows, managed by admin.
- Personalized ordering based on explicit business profile and recent behavior; never block basic discovery on personalization.
- Horizontal template rows and category grid pages.
- Muted looping previews, lazy initialization, pause off-screen, concurrency limits, reduced-data behavior, and poster-image fallback.
- Template detail shows sample outputs, expected duration, price, supported formats, and required inputs.
- Deep links resolve stable template IDs and gracefully handle archived/unavailable versions.

### Generate form

Render from the server-provided restricted input definition while using native Flutter widgets. Supported controlled field types include:

- Required script or business brief
- Conditional character picker
- Voice picker with favorites first
- Duration options allowed by the selected model version
- Orientation/aspect ratio options
- Resolution options
- Brand kit
- Product images, logo, background, CTA, and other template-declared assets

Before submission show the final credit quote, expected processing range, consent reminder where relevant, and cancellation/refund policy.

### Character tab

- Stock and user-created character sections.
- Create, name, preview, archive, and delete a user character.
- Upload/select backgrounds and associate a brand kit.
- Browse and preview compatible voices.
- Favorite voices; favorites sync to the server.
- Explain incompatible character/voice/template combinations instead of silently hiding data.

### History tab

- Cursor-paginated list/grid of every generation job.
- Thumbnail, template/version display name, created date, duration, status, progress, and failure action.
- Sort by newest, oldest, and duration.
- Filter by category, orientation, resolution, status, brand, and character.
- Full-screen adaptive playback from Stream.
- Download, platform share, delete, regenerate, and report actions.
- Regenerate creates a new job using an editable copy of the old snapshot; it never mutates the old job.
- Deleting removes the user's active reference immediately and schedules asset deletion according to retention/audit policy.

### Notifications

- D1 notification inbox is the source of truth.
- Unread count, pagination, mark read/all read, and deep-link target.
- Push is a delivery channel, not the notification record.
- FCM/APNs token rotation, multiple devices, logout unregister, invalid-token cleanup, user preferences, quiet hours, and deduplicated dispatch.
- Notify for completed, failed-with-action, refund, low-credit, account/security, and system events.

### Settings and accessibility

- System/light/dark theme throughout the application.
- Localization-ready strings and locale-aware formatting.
- Screen-reader labels, keyboard/focus support where applicable, sufficient contrast, reduced motion, text scaling, and captioned preview media.
- Data export, account deletion, consent management, and notification controls.

---

## 10. API and contract rules

- Keep public routes under `/api/v1`; introduce `/api/v2` only for breaking public contracts.
- Use Better Auth bearer sessions and server-side authorization on every tenant resource.
- Validate every path, query, body, webhook, queue message, Workflow payload, and Durable Object message with shared Zod schemas.
- Use standard success/error envelopes and stable machine-readable error codes.
- Use cursor pagination for templates, jobs, notifications, users, and audit logs.
- Return request/correlation IDs to clients and propagate them through jobs and provider calls.
- Support conditional GET/ETag for catalog reads.
- Use idempotency keys for generation, rendering, purchases, refunds, device registration, and destructive operations.
- Never accept provider IDs, price amounts, credit amounts, roles, asset ownership, or entitlement decisions as trusted client input.
- Generate an OpenAPI specification from or alongside shared contracts and test client/API compatibility in CI.

---

## 11. Security, safety, privacy, and compliance

### Application security

- Enforce authorization in Workers; hiding UI is never an access control.
- Protect admin behind Cloudflare Access plus application RBAC and MFA-capable identity.
- Use exact CORS origins, secure headers, request-size limits, rate limits, WAF rules, and Turnstile on abuse-prone anonymous flows.
- Issue short-lived direct upload/download URLs.
- Validate MIME signatures and isolate untrusted uploads from public delivery until approved.
- Keep secrets outside D1, KV, logs, source code, and client builds.
- Redact scripts, prompts, provider payloads, tokens, and personal data from normal logs.
- Scan dependencies and container images in CI and pin production model/renderer versions.

### AI safety and rights

- Require users to confirm rights to faces, voices, logos, products, music, and other uploaded content.
- Prohibit impersonation, deceptive endorsements, sexual exploitation, minors misuse, and unlawful content.
- Apply pre-generation input policy checks and post-generation output checks appropriate to the model/provider.
- Preserve moderation decisions, policy version, and appeal/review history.
- Add visible or metadata-based AI provenance/watermarking where product policy or law requires it.
- Custom voice cloning remains disabled until consent verification and abuse response processes are operational.

### Privacy and lifecycle

- Define retention separately for raw uploads, character sources, job metadata, generated masters, previews, logs, and deleted accounts.
- Implement export and deletion as durable Workflows with verifiable completion.
- Document data regions and subprocessors for external model providers.
- Maintain consent-policy versions and timestamps.
- Back up critical D1 data and test restoration; object lifecycle is not a substitute for backup policy.

---

## 12. Reliability, scalability, and observability

### Reliability patterns

- No mutable correctness-critical state in Worker globals.
- Every external side effect is idempotent or protected by a unique operation key.
- Retries use bounded exponential backoff with jitter and error classification.
- Circuit breakers/provider kill switches prevent cascading failures and runaway spend.
- Dead-letter queues have dashboards, alerts, and a documented replay process.
- Scheduled reconcilers detect stuck workflows, missing webhooks, orphaned assets, unclosed credit reservations, and notification failures.
- Graceful degradation keeps catalog/history available during provider outages.

### Scaling strategy

- Stateless API Workers scale horizontally.
- D1 stores relational truth; KV and CDN cache read-heavy published catalog data.
- Queues absorb bursts and enforce cost/concurrency backpressure.
- Workflows isolate long-running generation steps.
- Durable Objects coordinate per-job realtime updates rather than becoming the global database.
- R2 holds masters; Stream serves playback so API Workers never proxy video bytes.
- Direct uploads prevent large user files from consuming Worker request paths.
- Provider/model concurrency budgets are configuration, not hard-coded constants.
- If D1 write contention becomes measurable, move only proven hot coordination workloads to Durable Objects or partition services; do not prematurely fragment relational data.

### Required telemetry

Attach environment, request ID, user hash, job ID, template/version, provider/model version, attempt, and stage where appropriate:

- API latency/error rate by route
- Generation queue time and end-to-end completion time
- Success/failure/cancellation rate by template and model
- Provider latency, retry rate, webhook lag, and error classes
- Render queue depth, container startup/render time, and dead-letter volume
- Credits reserved/captured/refunded and reconciliation mismatches
- Estimated versus actual cost and gross margin per completed video
- Stream publication/playback failures
- Push delivery and invalid-device-token rate
- Funnel events from template impression through completed-video download/share

Define staging and production service-level objectives before launch. At minimum, set objectives for API availability, accepted-job durability, generation completion rate, notification delay, and recovery time. Alert on user impact and budget anomalies, not only infrastructure errors.

---

## 13. Environment, deployment, and release engineering

- Maintain fully separate development, staging, and production D1 databases, KV namespaces, R2 buckets, Stream configuration, queues, Workflows, Durable Objects, containers, domains, service bindings, analytics datasets, and secrets.
- Provision infrastructure declaratively where supported; keep checked-in `wrangler.jsonc` files and an environment inventory.
- Apply forward-only D1 migrations in staging first and use expand/migrate/contract for destructive schema changes.
- CI must run formatting, lint, TypeScript typecheck, Flutter analyze, unit tests, contract tests, migration tests, security scans, and production builds.
- CD deploy order must respect bindings and schema compatibility. Run automated smoke tests after each staging deployment.
- Use feature flags and percentage rollout for new models/templates/pipelines.
- Never combine a risky database migration, provider switch, renderer switch, and client release in one irreversible rollout.
- Maintain runbooks for provider outage, queue backlog, stuck Workflow, failed migration, credit mismatch, leaked secret, abusive content, and Stream/R2 delivery failure.

---

## 14. Phased implementation roadmap

Each phase must build on the existing code, include migrations and tests, run in staging, list all changed files and assumptions, and stop for confirmation before the next phase.

### Phase 0: baseline and de-risk the current platform

- Inventory the deployed Cloudflare resources and active legacy dependencies.
- Apply/verify current production-hardening migrations in staging.
- Complete and benchmark the existing Cloudflare Container renderer deployment.
- Run one existing template end to end: auth -> quote -> generation -> editor -> render -> R2 -> playback -> notification.
- Measure success rate, latency, and cost; record current gaps.
- Establish environment separation, request IDs, CI gates, backups, and rollback procedures.

**Exit gate:** a repeatable staging deployment and documented end-to-end baseline exist. No unknown production dependency remains.

### Phase 1: data model and shared contracts

- Add versioned catalog, provider/model registry, job/attempt/event/asset, credit reservation, voice, stock character, user character, favorite, entitlement, consent, and audit schemas.
- Use additive migrations and backfill the current templates/projects/render jobs.
- Expand shared Zod contracts and API error codes.
- Add operation/idempotency keys and validated job transitions.
- Add OpenAPI/contract tests.

**Exit gate:** migrations work on a production-like database, old app endpoints continue to function, and new invariants have automated tests.

### Phase 2: admin control plane foundation

- Upgrade admin authentication to Cloudflare Access plus server-side RBAC.
- Implement categories, template drafts/versions/publication, provider models, voices, stock characters, media presets, pricing, and audit logs.
- Upload admin-managed assets directly to R2/Stream/Images.
- Publish validated catalog snapshots to KV.
- Add staging preview, canary rollout, rollback, and provider kill switches.

**Exit gate:** a content manager can publish a tested template without a client or backend deployment, and every change is audited and reversible.

### Phase 3: Flutter app shell and catalog discovery

- Finalize splash/onboarding/auth routing and first-run persistence.
- Implement the three-tab responsive shell: Home, Character, History.
- Replace the current project-first home page with admin-driven category rows and retain project access through History.
- Implement efficient auto-previews using Stream with poster/reduced-data fallbacks.
- Add category pages, template detail, caching, loading/empty/error states, deep links, theme, and accessibility.

**Exit gate:** catalog publishing changes staging discovery without an app release; previews pause off-screen and degraded browsing works from cache.

### Phase 4: one production vertical slice

- Select one commercially useful template and one pinned provider model.
- Implement server-driven form fields and compatibility validation.
- Implement quote, atomic credit reservation, idempotent job creation, Workflow submission, webhook/poll handling, durable R2 ingestion, rendering, Stream publishing, and completion notification.
- Add provider adapter error classification, retry boundaries, cancellation, refund/release, and reconciliation.
- Display live job progress through Durable Objects with polling fallback.

**Exit gate:** duplicate submissions/webhooks cannot double-charge or duplicate work; provider URLs are not persisted as final assets; failure and cancellation policies are tested.

### Phase 5: History, playback, and notifications

- Build cursor-paginated History with all required sort/filter/status states.
- Add full-screen Stream playback, signed download, share, soft delete, regenerate, report, and failure recovery actions.
- Complete notification inbox, unread counts, deep links, preferences, multiple devices, token cleanup, and deduplication.
- Add support-visible job timelines and safe retry/refund actions in admin.

**Exit gate:** a user can leave the app after submission and reliably return through push or History to a playable video.

### Phase 6: characters, voices, and brand consistency

- Publish curated voices and stock characters through admin.
- Implement favorites and compatibility rules.
- Add direct user uploads, consent, validation, moderation, versioned user characters/backgrounds, and deletion lifecycle.
- Extend brand kits and snapshot versions into jobs.
- Add character/voice preparation Workflows and admin moderation queues.

**Exit gate:** tenant isolation and consent/deletion tests pass; the same ready character/brand can be reused predictably across compatible templates.

### Phase 7: subscriptions, commerce, and cost controls

- Define plans, entitlements, credit packs, renewal behavior, and store product mappings.
- Validate Google Play and Apple purchases server-side with replay protection.
- Complete the reservation/capture/refund ledger and reconciliation dashboards.
- Add per-user, per-plan, per-model, and global budget/concurrency limits.
- Add cost/margin reporting and automated provider spend alerts.

**Exit gate:** financial reconciliation tests pass and no client-controlled value can grant credits or change price.

### Phase 8: catalog expansion and provider resilience

- Add remaining business categories and templates through the admin publishing flow.
- Qualify additional pinned models/providers and Workers AI alternatives.
- Add tested fallback strategies, canary routing, regional availability, localization, and personalization.
- Load-test API bursts, catalog reads, Queue backlog, Workflows, D1 writes, Stream publishing, and renderer capacity.

**Exit gate:** a provider/model can be disabled or rolled back without an app release, and load tests meet defined SLOs and cost budgets.

### Phase 9: production launch hardening

- Complete threat modeling, privacy review, content policy, incident response, restore drill, account export/deletion, and store compliance.
- Run accessibility, device/network, upgrade, and failure-injection tests.
- Configure alerts, dashboards, on-call ownership, status communication, and support runbooks.
- Perform staged internal, beta, percentage, and general-availability rollouts.

**Exit gate:** launch checklist is signed off by product, engineering, operations, security/privacy, support, and finance owners.

### Future phases, only after core reliability

- Verified custom voice cloning.
- Team workspaces, roles, approval flows, and shared brand libraries.
- Campaign variants and automatic A/B testing.
- Product-catalog ingestion and bulk personalized video generation.
- API/webhook access for business customers.
- Translation, dubbing, and lip-sync with consent-aware regional policies.
- An AI campaign assistant that recommends templates and drafts briefs while keeping final generation deterministic and auditable.
- Semantic template discovery using Workers AI and Vectorize when catalog scale justifies it.

---

## 15. Testing requirements

Every phase adds tests proportional to risk:

- Unit tests for pricing, compatibility, transitions, authorization, input mapping, and error classification.
- Contract tests across Flutter, API, Workflows, Queues, Durable Objects, renderer, and admin.
- Migration and backfill tests using realistic existing data.
- Integration tests with recorded provider fixtures plus scheduled live-provider smoke tests.
- Idempotency tests for duplicate requests, webhooks, queue delivery, Workflow retries, purchases, notifications, and refunds.
- Security tests for tenant isolation, admin permissions, upload/download authorization, CORS, and secret/log redaction.
- Failure-injection tests for provider timeout, malformed output, missed webhook, R2/Stream failure, Queue retry, container crash, and notification failure.
- Flutter widget/golden tests for themes, text scaling, loading/error/empty states, and critical journeys.
- End-to-end staging tests for sign-up, purchase/credit, generation, cancellation/failure, completion, download/share, character creation, and deletion.
- Load and soak tests driven by realistic provider and renderer concurrency budgets.

Compilation alone is not a phase completion criterion.

---

## 16. Definition of production-ready

The platform is production-ready only when:

- The active architecture and system of record are unambiguous.
- All application infrastructure is deployed through Cloudflare, with documented external AI/push/store integrations.
- Admins can safely publish and roll back templates, models, voices, characters, pricing, and feature flags without code releases.
- Published jobs are reproducible from immutable configuration snapshots.
- Cost-bearing operations are idempotent and financially reconcilable.
- Generated media is durably owned in R2 and delivered through Stream; provider URLs are never the permanent source.
- Webhooks, retries, cancellation, dead letters, stuck-job recovery, and provider outages are handled and observable.
- Tenant isolation, consent, moderation, data export, and deletion are tested.
- Staging mirrors production and deployment/rollback/restore procedures have been exercised.
- Service-level objectives, alerts, dashboards, runbooks, budget limits, and responsible owners exist.
- The Flutter app passes supported-device, poor-network, accessibility, theme, upgrade, and background/notification testing.

---

## 17. Implementation rules for coding agents

- Explore the relevant existing code before editing.
- Use current Flutter, Riverpod, GoRouter, Hono, Drizzle, Zod, and Cloudflare conventions already in the repository.
- Do not introduce a library when the repository already has an equivalent.
- Do not create new tables outside `api/packages/db`; do not define cross-service payloads outside `api/packages/shared`.
- Do not hard-code templates, model IDs, voice catalogs, stock characters, prices, secrets, or provider capabilities in Flutter.
- Do not place provider-specific payloads in public API contracts.
- Do not perform long-running or cost-bearing generation directly in request handlers.
- Do not proxy large uploads/downloads/video playback through API Workers.
- Do not store correctness-critical mutable state in Worker globals or KV.
- Do not mutate published template/model versions or historical ledger entries.
- Do not continue to the next phase until the current exit gate is verified in staging.
- After each phase, report changed files, migrations, Cloudflare resources/bindings, secrets/configuration required, tests run, measured results, assumptions, remaining risks, and rollback instructions; then wait for confirmation.

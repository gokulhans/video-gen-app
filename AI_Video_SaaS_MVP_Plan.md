# AI Video SaaS — Technical & Feature Plan (MVP, v2)

## Vision

AI-powered short video generation for Indian businesses: 30–60 second
promotional videos from a text prompt, editable on mobile, exported as MP4.

## Target Customers

- Local businesses (restaurants, clinics, salons, gyms, jewellery, furniture, fashion)
- Digital marketing agencies (multi-client — future white-label upsell)
- Real estate agents
- Educational institutes

**MVP focus:** pick 2–3 verticals (e.g. restaurants, salons, real estate) and
nail their templates before going broad. Twelve mediocre templates convert
worse than three great ones.

---

## Key Strategic Decision: Reuse the Existing Backend

We already have a working Next.js platform with the full pipeline:
script → voiceover → Whisper timestamps → scenes → Flux images → effects →
captions → Remotion Lambda cloud render, plus auth (better-auth), a token
system with admin-adjustable costs, render job tracking, and notifications.

**MVP approach: Flutter app talks to the existing Next.js API.**
Do NOT rebuild the backend on Cloudflare Workers for the MVP.

- The Cloudflare stack (Workers/D1/Queues/DO) is a full rewrite: new DB
  (Neon → D1), new auth, new queue, new render orchestration. That is months
  of work delivering zero new user value.
- Migrate to Cloudflare later if costs or latency justify it — the mobile app
  won't care because it only sees the API.

What the backend needs for mobile (small additions, not a rewrite):
- [ ] Bearer-token / session auth that works from Flutter (better-auth supports this; verify cookie vs token flow)
- [ ] Versioned API surface (`/api/v1/...`) so web UI changes don't break the app
- [ ] Push notification delivery (FCM) alongside existing email/browser notifications
- [ ] Signed URLs for asset download to device

## Tech Stack

### Mobile
- Flutter (Android first; iOS later — but keep plugins iOS-compatible from day 1)
- Local preview: Flutter-rendered preview (widgets over image + audio), NOT a rendered video

### Backend (existing, extended)
- Next.js API routes (current), Neon Postgres + Drizzle, better-auth
- Storage: R2/S3 (already in place)
- Render: Remotion Lambda (already working, with progress + job tracking)
- Future migration target: Cloudflare Workers + Containers — revisit post-PMF

### AI Providers (already integrated)
- Script / scenes / effects: GPT-4o-mini (add Gemini Flash as fallback — cheaper, and resilience against provider outage)
- Timestamps: Whisper (word-level — already powers TikTok captions)
- Voiceover: OpenAI TTS + Gemini TTS (Gemini is important for Indian-language voices)
- Images: Replicate Flux-Schnell (add one quality tier, e.g. Flux-Dev, as a premium option)

## Rendering: Cloud First, Local Later

The original plan proposed local Android rendering (FFmpeg/MediaCodec). Defer it.

- Local rendering with animated captions, transitions, and Ken Burns effects on
  fragmented Android hardware is the single riskiest item in the plan —
  easily 2–3 months alone, with per-device bugs.
- Remotion Lambda rendering **already works** with progress reporting and
  push/email notification on completion. Mobile just polls / receives a push
  and downloads the MP4.
- Cost control: renders already gate on tokens; cloud render cost is passed
  through the token price.
- Revisit local rendering only if Lambda costs become a real margin problem
  at scale.

## Workflow (user-facing)

1. Pick template (vertical + style + music preset + sample output video)
2. Enter topic / offer details (+ optional phone, address, price — templates slot these in)
3. Choose language & duration → **show estimated token cost up front**
4. One tap: generate script → narration → timestamps → scenes → images
   (server-side chain; app shows one progress screen, not 8 steps)
5. Edit: script text, swap/regenerate images, voice, captions style, music, logo/brand
6. Render (cloud) → push notification when ready
7. Download / share (WhatsApp share intent is the #1 channel for this market)

**Key change vs v1:** collapse the 8-step generation into one background chain
with a single progress screen. The web app's step-by-step flow is a known
onboarding/abandonment problem (see PRODUCT_IMPROVEMENT_ANALYSIS.md). Mobile
users will not tolerate it.

Resilience requirements (learned from the web app's pain points):
- Each pipeline stage retryable independently without losing prior stages
- Failed image for one scene ≠ failed project; show placeholder + "regenerate"
- Autosave project JSON after every stage and every edit

## Data Model

Reuse the existing schema; extend rather than redesign:

- `user` — exists (tokens, isAdmin). Add: `phone` (Indian market — OTP login via phone is expected), `fcmToken`.
- `projects` — exists, already stores scenes/composition/captionConfig as JSON. Add: `templateId`, `brandId`, `schemaVersion` (project JSON version — old app builds must open old projects).
- **`brand` — NEW**: userId, name, logo URL, primary/secondary colors, font, phone, website, watermark toggle. One user → multiple brands (agencies).
- **`templates` — NEW**: vertical, name, preview video URL, script prompt preset, image style preset, music track, caption style, default duration. Server-driven so templates ship without app releases.
- `token_costs` / `token_transactions` — exist. Add a `cost-estimate` endpoint: given template + duration, return total estimated tokens **before** generation starts.
- `render_jobs` — exists with progress. Reuse as-is.
- Scenes/subtitles stay inside project JSON (as today) — do not normalize into
  Scene/Subtitle tables; the JSON blob is the editing document.

## Editor Features

MVP (keep it small — every one of these needs touch UI + preview support):
- Script edit + AI rewrite (per-scene)
- Replace / regenerate image (regeneration costs tokens — show cost on button)
- Reorder scenes, adjust scene duration
- Caption style picker (color/position/preset — reuse existing TikTok caption styles)
- Voice selection (with audible samples — sample generator scripts already exist)
- Music: pick from curated library + volume/ducking
- Brand: logo placement corner picker, brand color applied to caption theme
- Export 720p / 1080p (1080p = premium/more tokens)

Post-MVP: crop & zoom per image, transition picker per scene boundary,
subtitle word-level editing, custom music upload.

## Monetization (was missing from v1 — critical)

- Free tier: signup bonus tokens (system exists), watermarked exports
- Token packs via **Google Play Billing** (mandatory for in-app purchase on Android)
- Optional subscription tier: monthly tokens + watermark removal + 1080p
- Pricing must account for: LLM + TTS + Flux + Lambda render cost per video.
  Compute the true cost-per-video from existing usage data before setting prices.
- Admin token-cost table already exists — use it to tune margins without releases.

## MVP Scope Cut List (explicitly OUT)

- Local/on-device rendering
- Cloudflare backend migration
- iOS, Web
- AI avatars, lip sync, voice cloning, stock video, team collaboration,
  white-label, API access (roadmap unchanged)
- AI thumbnails / hashtags / social captions — fast-follow, not MVP
  (cheap to add: single LLM call each, already have the pattern)

## Phased Delivery

**Phase 0 — Backend prep (1–2 wks)**
API versioning, mobile auth flow, cost-estimate endpoint, templates table +
seed 3 verticals, brand table, FCM push.

**Phase 1 — Generate & watch (3–4 wks)**
Flutter: onboarding + phone/Google login, template picker, topic form,
one-shot generation with progress, project list, playback of rendered video,
share to WhatsApp. (Render happens on Lambda; no editor yet.)
→ This alone is a demoable, sellable MVP.

**Phase 2 — Edit (3–4 wks)**
Editor screens: script, images, voice, captions, music, brand kit. Re-render.

**Phase 3 — Monetize & harden (2–3 wks)**
Play Billing, watermark on free tier, analytics (funnel per pipeline stage,
cost per video, render failure rate), crash reporting, retry/error UX polish.

## Success Metrics (define before launch)

- Activation: % of signups who get a finished rendered video in first session
- Time-to-first-video (target < 5 min including render)
- Render success rate (target > 97%)
- Cost per finished video vs revenue per video (unit economics)
- D7 retention, videos per business per month

## Risks

| Risk | Mitigation |
|---|---|
| Indian-language script/TTS quality (Hinglish, Tamil, etc.) | Gemini TTS already integrated; benchmark per language before listing it in the app |
| AI image quality for local-business subjects (food, interiors) | Template-tuned image prompts; allow user photo upload as scene image (upload API exists) |
| Render cost per video eats margin | Measure per-video cost now from existing web usage; price tokens accordingly |
| Play Store billing policy | Tokens must be bought via Play Billing, not external payment links |
| Provider outage (OpenAI/Replicate) | Secondary provider per stage (Gemini text/TTS already in codebase) |

# pipeline

Cloudflare Workflows worker for the AI video SaaS generation pipeline. Hosts
three Workflow classes, invoked by the `api` worker via service/workflow
bindings — this worker exposes no public HTTP routes.

## Workflows

- **GenerationPipeline** (`GENERATION_PIPELINE`) — full script → voiceover →
  timestamps → scenes → per-scene images → assemble → notify pipeline.
- **RegenerateSceneImage** (`REGEN_IMAGE`) — regenerate a single scene's image.
- **RegenerateVoiceover** (`REGEN_VOICE`) — regenerate the voiceover + word
  timestamps and refresh the composition.

## Bindings (wrangler.jsonc)

| Binding | Type |
|---|---|
| `DB` | D1 database `ai-video-db` |
| `ASSETS_BUCKET` | R2 bucket `assets` |
| `GENERATION_PIPELINE` | Workflow (this worker, class `GenerationPipeline`) |
| `REGEN_IMAGE` | Workflow (this worker, class `RegenerateSceneImage`) |
| `REGEN_VOICE` | Workflow (this worker, class `RegenerateVoiceover`) |

## Secrets

Set via `wrangler secret put <NAME>` (per environment):

- `OPENAI_API_KEY` — script generation, TTS, Whisper transcription
- `GEMINI_API_KEY` — fallback script generation, optional Gemini TTS (`voice: "gemini:<VoiceName>"`)
- `REPLICATE_API_TOKEN` — flux-schnell image generation, optional Whisper fallback
- `FCM_SERVICE_ACCOUNT_JSON` — full Firebase service-account JSON (single-line), used to
  mint FCM HTTP v1 OAuth tokens via WebCrypto (no firebase-admin dependency)

## Vars

`MEDIA_INGEST_SIGNING_SECRET` is only needed when the optional Stream adapter
is enabled; it signs 15-minute, path-bound URLs for private R2 master ingest.

- `AI_GATEWAY_BASE_URL` — Cloudflare AI Gateway prefix, e.g.
  `https://gateway.ai.cloudflare.com/v1/<account_id>/<gateway_id>`. Provider
  calls are appended as `/openai/...` and `/google-ai-studio/v1beta/models/...`.
- `APP_BASE_URL` — public base URL used to build asset URLs
  (`${APP_BASE_URL}/assets/<r2-key>`, see `src/env.ts#assetUrl`). Assumes the
  `api` worker serves/redirects that path to a presigned or public R2 URL —
  confirm the actual asset route with the `api` app and adjust `assetUrl` if
  it differs.

## AI Gateway setup

1. Create a gateway in the Cloudflare dashboard (AI > AI Gateway).
2. Enable logging + caching as desired; no gateway-side config is required for
   fallback routing — this worker does its own OpenAI→Gemini fallback in code
   (`generate-script` step) since Workflows steps need explicit control over
   which provider result to persist.
3. Set `AI_GATEWAY_BASE_URL` to the gateway's base URL (see above).

## Deploy

```bash
pnpm install
pnpm --filter @app/pipeline typecheck
wrangler secret put OPENAI_API_KEY
wrangler secret put GEMINI_API_KEY
wrangler secret put REPLICATE_API_TOKEN
wrangler secret put FCM_SERVICE_ACCOUNT_JSON
wrangler secret put MEDIA_INGEST_SIGNING_SECRET
wrangler deploy
```

The default `PLAYBACK_PROVIDER=r2` keeps the generated MP4 master private in R2
and returns a short-lived signed URL for playback. Stream remains an optional
adapter through the native `STREAM` binding; when enabled, the Workflow
checkpoints the Stream UID before polling `readyToStream`, so encoding retries
never re-upload a completed master.

Fill in `database_id` and the real `AI_GATEWAY_BASE_URL` in `wrangler.jsonc`
before deploying (placeholders are marked `<...>`).

## Workflow step list

**GenerationPipeline**
1. `deduct-tokens` — db.batch conditional deduct (script + voice + estimated
   per-scene image cost); insufficient balance → `generationStatus: failed` +
   `NonRetryableError`.
2. `load-template` — reads `scriptPromptPreset`, `imageStylePreset`,
   `musicTrackUrl`, `captionStyle`.
3. `generate-script` — OpenAI `gpt-4o-mini` via AI Gateway, exponential
   retry; falls back to Gemini `gemini-2.0-flash` in-step on failure.
4. `generate-voiceover` — OpenAI TTS (or Gemini TTS if `voice` is prefixed
   `gemini:`) → R2 `${userId}/${projectId}/voiceover.mp3`.
5. `generate-timestamps` — OpenAI Whisper `verbose_json` word-level
   transcription; falls back to Replicate `openai/whisper`.
6. `build-scenes` — deterministically buckets word timestamps into ~4s
   scenes, then one LLM call generates a flux-schnell image prompt per
   scene using the template's `imageStylePreset`; validated with the
   `Scene` zod schema.
7. `image-<sceneId>` (parallel, one per scene) — Replicate flux-schnell,
   poll-to-completion, download, upload to R2
   `${userId}/${projectId}/scenes/${sceneId}.webp`. Per-scene failures are
   caught inside the step and mark that scene `imageStatus: "failed"` —
   they never fail the workflow.
8. `assemble` — builds `ProjectComposition` (music + captions from the
   template, brand from the `brands` row if `brandId` set) and writes
   `script`/`voiceoverUrl`/`timestamps`/`scenes`/`composition`, marks
   `generationStatus: "complete"`.
9. `notify` — inserts a `generation_complete` notification row and sends an
   FCM push to all of the user's registered devices.

On any failure after `deduct-tokens` (steps 2–9), a `refund-tokens`
compensating step credits the full deducted amount back and a `mark-failed`
step sets `generationStatus: "failed"` + a `system` notification with the
error message, before the workflow re-throws.

**RegenerateSceneImage**: `deduct-tokens` (image cost) → `regenerate-image`
(Replicate flux-schnell, update scene + composition) → refund on failure.

**RegenerateVoiceover**: `deduct-tokens` (voice cost) → `load-script` →
`regenerate-voiceover` → `regenerate-timestamps` → `update-composition` →
refund on failure.

## Known deviations / TODOs

- **Gemini TTS output format**: Gemini's TTS models return raw 16-bit PCM,
  not MP3 (Workers has no ffmpeg/mp3 encoder available). `providers/gemini.ts`
  wraps the PCM in a WAV container and stores it under the same `.mp3`-suffixed
  R2 key the contract specifies. Downstream consumers (mobile player, Remotion
  render) need to sniff/handle WAV bytes served from a `.mp3` key if the
  `gemini:` voice prefix is ever used in practice. Recommend transcoding via a
  small ffmpeg step in the render container, or restricting `gemini:` voices
  until that exists.
- **Asset URLs**: `assetUrl()` assumes `${APP_BASE_URL}/assets/<key>` is a
  route the `api` worker serves (presigned redirect or public R2 mapping).
  CONTRACTS.md lists an "assets (presigned upload/download)" surface on `api`
  but doesn't pin the exact path — confirm/align when `apps/api` is built.
- **Replicate Whisper fallback** (`generate-timestamps` / `regenerate-timestamps`)
  requires the voiceover to be fetchable at a public URL; this only works if
  `ASSETS_BUCKET` has a public custom domain configured. If not, the fallback
  will itself fail — acceptable since OpenAI Whisper is the primary path, but
  worth wiring an R2 public bucket URL before relying on the fallback.
- **Cost estimation for `deduct-tokens`**: the image count charged upfront is
  an estimate (`round(durationSec / 4)` scenes at `image_generation` cost per
  scene); the actual scene count from `build-scenes` may differ slightly.
  No mid-workflow true-up/refund for this delta is implemented — only a full
  refund on hard failure. Flag for product decision if exact accounting matters.
- Workflow `limits.steps` in `wrangler.jsonc` are placeholders; tune once
  typical scene counts per video are known.

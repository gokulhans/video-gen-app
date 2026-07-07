# containers/renderer

Docker image for the Remotion renderer used by `apps/render`'s
`RendererContainer` (`env.RENDERER.getByName(jobId)`). One container instance
handles exactly one render job (`sleepAfter: "10m"` set on the `Container`
class in `apps/render/src/do.ts`).

Adapted from the existing `remotion/` compositions at the repo root
(`Root.jsx`, `Scene.jsx`, `TikTokCaption.jsx`, `TransitionScene.jsx`,
`VideoComposition.jsx`) to take a single `composition: ProjectComposition`
input prop (the same JSON document `apps/api`/`apps/pipeline` produce and
store in `projects.composition`), instead of the original ad-hoc
`scenes`/`voiceoverUrl`/`timestamps` props. Type shapes are duplicated as
plain JSDoc in `remotion/types.js` — **this app does not import `@app/shared`
or any other workspace package**; it's a standalone Docker image built and
deployed independently of the pnpm workspace.

## Layout

- `Dockerfile` — Node 22 + headless Chromium deps + `npx remotion browser
  ensure` (pre-downloads Remotion's managed Chromium at build time).
- `server.mjs` — tiny `node:http` server:
  - `POST /render` — accepts a `RenderRequest` JSON body
    (`{ jobId, composition, resolution, outputKey }`), responds `202`
    immediately, and runs `renderMedia()` in the background.
  - `GET /progress/:jobId` — `{ status, progress, videoUrl?, error? }`,
    polled by `apps/render`'s queue consumer.
  - `GET /healthz` — liveness check (used by the Dockerfile `HEALTHCHECK`).
- `remotion/` — the bundled Remotion project:
  - `index.js` — `registerRoot`.
  - `Root.jsx` — single `MainComposition`; `calculateMetadata` derives
    width/height from `composition.ratio` + `resolution` (720p = 720x1280,
    1080p = 1080x1920 for `9:16`, analogous for `1:1`/`16:9`) and duration
    from `composition.durationSec` (30fps fixed).
  - `VideoComposition.jsx` — lays out scenes as `Sequence`s from
    `scene.start`/`scene.end`, groups `composition.words` into TikTok-style
    caption chunks, renders voiceover/music `Audio`, and an optional brand
    logo overlay.
  - `TransitionScene.jsx` / `Scene.jsx` / `TikTokCaption.jsx` — per-scene
    rendering: `scene.effect` (`zoom_in`/`zoom_out`/`pan_left`/`pan_right`/
    `none`) and `scene.transition` (`none`/`fade`/`slide`/`wipe`) drive the
    per-frame styles; captions read `composition.captions`
    (`preset`/`position`/`primaryColor`/`highlightColor`/`fontSize`).

## R2 upload

The container has no access to Cloudflare Worker bindings (it's a plain
Docker process), so it talks to R2 over the S3-compatible API using
[`aws4fetch`](https://github.com/lp0hop/aws4fetch) instead of the AWS SDK
(smaller, zero native deps — better fit for a container image). Credentials
arrive as env vars, set by `apps/render`'s `RendererContainer.envVars` (see
`apps/render/src/do.ts`), sourced from Worker secrets:

| Env var | Source |
|---|---|
| `R2_ACCOUNT_ID` | secret |
| `R2_ACCESS_KEY_ID` | secret |
| `R2_SECRET_ACCESS_KEY` | secret |
| `R2_RENDERS_BUCKET_NAME` | plain var, defaults to `renders` |

On success the server responds to `/progress/:jobId` with
`{ status: "completed", progress: 100, videoUrl: <R2 key>, key: <R2 key> }`.
The render worker stores that key as `render_jobs.videoUrl`; turning it into
a shareable/presigned download URL is `apps/api`'s job (same pattern as the
existing asset presigned-download endpoint), not this container's.

## Local build/run

```sh
cd containers/renderer
docker build -t renderer-container .

docker run --rm -p 8080:8080 \
  -e R2_ACCOUNT_ID=xxxx \
  -e R2_ACCESS_KEY_ID=xxxx \
  -e R2_SECRET_ACCESS_KEY=xxxx \
  -e R2_RENDERS_BUCKET_NAME=renders \
  renderer-container
```

## Sample render request

```sh
curl -X POST http://localhost:8080/render \
  -H "content-type: application/json" \
  -d '{
    "jobId": "job_abc123",
    "resolution": "720p",
    "outputKey": "renders/user_1/job_abc123.mp4",
    "composition": {
      "schemaVersion": 1,
      "ratio": "9:16",
      "durationSec": 6,
      "language": "en",
      "script": "Hello world",
      "voice": "alloy",
      "voiceoverUrl": null,
      "musicUrl": null,
      "musicVolume": 0.15,
      "scenes": [
        {
          "id": "s1",
          "order": 0,
          "text": "Hello world",
          "start": 0,
          "end": 6,
          "imagePrompt": "",
          "imageUrl": null,
          "imageStatus": "ready",
          "effect": { "type": "zoom_in", "intensity": 0.5 },
          "transition": "fade"
        }
      ],
      "words": [],
      "captions": {
        "enabled": true,
        "preset": "tiktok",
        "position": "bottom",
        "primaryColor": "#FFFFFF",
        "highlightColor": "#FFD700",
        "fontSize": 48
      },
      "brand": {
        "logoUrl": null,
        "logoPosition": "top_right",
        "primaryColor": null,
        "phone": null,
        "website": null,
        "watermark": true
      }
    }
  }'
# -> 202 { "accepted": true, "jobId": "job_abc123" }

curl http://localhost:8080/progress/job_abc123
# -> { "status": "rendering", "progress": 40 }
# ... poll until:
# -> { "status": "completed", "progress": 100, "videoUrl": "renders/user_1/job_abc123.mp4", "key": "..." }
```

Without real R2 credentials the render itself will still run and produce
`/tmp/job_abc123.mp4`, but the upload step will fail and the job will report
`status: "failed"` with an R2-credentials error — that's expected for a
credential-less local smoke test; check the container logs to confirm the
render itself (Chromium + `renderMedia`) succeeded.

## TODOs / deviations

- No deviations from the render task's Dockerfile/server spec.
- TODO: benchmark 720p/1080p render times on `standard-4` (Cloudflare
  Rewrite Plan §4/§8 Phase-0 gate) and tune `concurrency` /
  `POLL_INTERVAL_MS` (in `apps/render/src/consumer.ts`) accordingly.
- TODO: chunked multi-container rendering (plan's fallback if a single
  container is too slow at 1080p) is not implemented — out of scope per the
  task brief ("one render job = one container instance").
- TODO: caption preset styling here is a simplified port of the original
  8-preset system (`tiktok`/`instagram`/`neon`/`luxury`/... in the old
  `TikTokCaption.jsx`) collapsed onto the 4 presets defined in
  `packages/shared` (`tiktok`/`clean`/`bold`/`karaoke`). Visual parity with
  the old renderer was not a goal; contract compliance was.

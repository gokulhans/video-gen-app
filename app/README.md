# AI Video Maker — Flutter app

Android-first Flutter client for the AI video SaaS backed by the Cloudflare
Workers API described in `appplan/api/CONTRACTS.md`. State management:
Riverpod. Routing: go_router. Networking: dio + flutter_secure_storage.

This app was hand-scaffolded (not via `flutter create`, though the platform
folders — `android/`, `ios/`, etc. — already existed in this workspace from
an earlier `flutter create .` run). The Dart SDK/tooling may not be installed
on every machine that clones this repo, so **no `flutter pub get` or `flutter
run` was executed while building this** — do that first thing on a machine
with Flutter installed.

## 1. Prerequisites

- Flutter 3.32+ / Dart 3.10+ (see `environment.sdk` in `pubspec.yaml`).
- Android Studio or the Android SDK command-line tools + an emulator or
  device for Android-first testing.
- A Firebase project (for FCM push notifications).

## 2. First-time setup

```bash
cd appplan/app
flutter pub get
```

If `android/`, `ios/`, etc. are ever missing or corrupted, regenerate the
platform folders without touching `lib/`:

```bash
flutter create . --platforms=android,ios --project-name ai_video_maker
```

(The platform folders in this repo already exist — this is only a repair
step.)

## 3. Configure the API base URL

The app reads its base URLs from compile-time environment variables (see
`lib/core/constants.dart`). Pass them via `--dart-define` (or a
`--dart-define-from-file=env.json` file, gitignored):

```bash
flutter run \
  --dart-define=API_BASE_URL=https://<your-worker>.workers.dev/api/v1 \
  --dart-define=AUTH_BASE_URL=https://<your-worker>.workers.dev/api/auth \
  --dart-define=GOOGLE_SERVER_CLIENT_ID=<your-google-oauth-web-client-id>
```

- `API_BASE_URL` — the `apps/api` Hono worker's `/api/v1` prefix (CONTRACTS.md).
- `AUTH_BASE_URL` — the better-auth handler's base path, `/api/auth` (separate
  prefix per CONTRACTS.md — better-auth owns its own REST surface).
- `GOOGLE_SERVER_CLIENT_ID` — the **web** OAuth client id from Google Cloud
  Console, used by `google_sign_in` so the ID token can be verified/exchanged
  server-side by better-auth's Google provider.

## 4. Firebase / FCM setup (push notifications)

1. Create (or reuse) a Firebase project and add an Android app with package
   name matching `android/app/build.gradle.kts` → `applicationId`
   (`com.aivideogen.app`).
2. Download `google-services.json` from the Firebase console and place it at
   `android/app/google-services.json`.
3. Add the Google Services Gradle plugin (not added yet, since the JSON file
   isn't present in this scaffold):
   - `android/build.gradle.kts` (top-level, in the `plugins {}` block or
     `dependencies` of the root buildscript per the Flutter Gradle DSL):
     `id("com.google.gms.google-services") version "4.4.2" apply false`
   - `android/app/build.gradle.kts` `plugins {}` block:
     `id("com.google.gms.google-services")`
4. For iOS, download `GoogleService-Info.plist` and add it to
   `ios/Runner/` via Xcode (so it's included in the bundle), and enable Push
   Notifications + Background Modes → Remote notifications capabilities.
5. `lib/features/notifications/services/fcm_service.dart` handles requesting
   permission, registering the device token with `POST /devices`, and
   foreground/background/tap handling. It no-ops gracefully if Firebase
   hasn't been initialized (e.g. `google-services.json` missing), so the rest
   of the app still runs without it.
6. The server side needs `FCM_SERVICE_ACCOUNT_JSON` configured (already in
   CONTRACTS.md's secrets list) to actually send pushes.

## 5. Google Sign-In

`google_sign_in` (v6, Android/iOS) needs:
- The Android SHA-1/SHA-256 signing certificate fingerprints registered in
  the Firebase/Google Cloud OAuth client for this app's package name.
- `GOOGLE_SERVER_CLIENT_ID` passed at build time (see §3) so the ID token can
  be verified server-side (better-auth's Google provider uses
  `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, already in CONTRACTS.md).

## 6. Application identifier

The release identifier is `com.aivideogen.app` across Android, iOS, macOS,
Linux, and the checked-in Firebase platform configuration. Keep the same
identifier when creating store listings, signing profiles, and Firebase apps.

This must match the package name registered in the Firebase console and the
Play Console.

## 7. Google Play Billing (tokens purchase)

`lib/features/tokens/screens/purchase_screen.dart` wires up `in_app_purchase`
for a consumable-token purchase flow. It is safe to ship only after the
matching store products and server-owned catalog are configured:
product ids (`tokens_500`, `tokens_1500`, `tokens_5000`) must be created as
in-app products in the Play Console before `queryProductDetails` will return
anything. Once purchases succeed, the client posts the purchase token to
`POST /tokens/purchase/verify` for server-side receipt validation (per
CONTRACTS.md) before crediting tokens — the client never credits tokens
locally.

## 8. Cloudflare static web hosting

The Flutter web build can be deployed as a Cloudflare Workers static asset
deployment using [wrangler.jsonc](./wrangler.jsonc):

```bash
flutter build web --release
npx wrangler deploy
```

Use environment-specific API/Auth `dart-define` values and a separate static
asset Worker for staging.

## 9. Running

```bash
flutter run --dart-define=API_BASE_URL=... --dart-define=AUTH_BASE_URL=...
```

## 10. Architecture

```
lib/
  main.dart              Firebase init, FCM wiring, MaterialApp.router
  router.dart             go_router routes + auth-gated redirects
  theme.dart               Material 3 light/dark themes
  core/
    constants.dart         Base URLs, secure-storage keys, poll intervals
    api_client.dart         dio + envelope ({data}/{error}) parsing, auth interceptor
    auth_repository.dart    better-auth email/password + Google sign-in, session persistence
    models/                 Dart mirrors of packages/shared/src/index.ts
      composition.dart       ProjectComposition, Scene, CaptionConfig, BrandConfig,
                              WordTimestamp, GenerationParams, RenderProgressMessage,
                              GenerationStage
      project.dart            Project + status-chip derivation
      template.dart           VideoTemplate, VoiceOption
      brand.dart              Brand (brands table)
      render_job.dart         RenderJob, RenderResolution
      notification.dart       AppNotification
      token_balance.dart      TokenBalance, TokenTransaction, CostEstimate
      user.dart               AppUser
    repositories/            One class per API resource group (projects, templates,
                              brands, tokens, render, notifications, assets), each
                              exposing a Riverpod provider.
  features/
    auth/                  Sign in / sign up / onboarding
    home/                  Project list, status chips, token balance, pull-to-refresh
    create/                Template picker -> topic form (cost estimate) -> generation progress
    editor/                Tabbed editor: Script / Images / Voice / Captions / Music / Brand,
                            autosaved via PATCH /projects/:id/composition (2s debounce)
    render/                Resolution picker -> WS+polling progress -> playback/download/share
    notifications/         List + FCM registration/handlers
    tokens/                 Balance/history + Play Billing purchase stub
```

## 11. Known TODOs / assumptions

- **Auth response shape**: `AuthRepository._persistSession` assumes
  better-auth returns `{ token, user }` (or nested under `data`). Confirm the
  exact shape against the deployed better-auth handler and adjust if needed.
- **`GET /auth/me`**: used by `authStateProvider` to fetch the current user
  after restoring a token from secure storage; not explicitly listed in
  CONTRACTS.md — confirm the route name with the API team (falls back to
  "signed out" on any failure, so it fails safe).
- **Voices catalog**: assumed `GET /voices` (optionally `?language=`)
  returns `[{id, label, language, sampleUrl, gender}]`. Not in CONTRACTS.md's
  route list explicitly; confirm/adjust `TemplateRepository.listVoices`.
- **Script rewrite / scene image regen / voice regen endpoints**: assumed
  `POST /projects/:id/script/rewrite`, `POST /projects/:id/scenes/:sceneId/regenerate-image`,
  `POST /projects/:id/voice/regenerate`. These map to the "script_rewrite"
  and "image_generation" `TokenAction`s in `packages/shared` but exact route
  paths should be confirmed against the API implementation.
- **Assets upload-url response shape**: assumed
  `{uploadUrl, assetKey, publicUrl}` for the presigned-PUT flow used by the
  Images tab's "replace from gallery" action.
- **WebSocket auth**: `RenderProgressController` appends `?token=<bearer>` as
  a query param when connecting to `/render-jobs/:id/ws` since browsers/`
  web_socket_channel` can't set custom headers on the handshake; confirm the
  API worker reads the token from the query string for the WS upgrade (or
  swap for whatever scheme the render worker expects).
- **In-app purchase**: Play Billing product ids are placeholders; wire up
  real products + test with a licensed tester account before shipping.
- **google-services.json / GoogleService-Info.plist**: not included (they're
  per-environment secrets) — add them per §4 before FCM will work.
- **Application id**: `com.aivideogen.app` (§6).
- App icons/splash screens are the Flutter defaults; swap via
  `flutter_launcher_icons` / `flutter_native_splash` if desired (not added
  as a dependency here to keep the dependency list matching the ask).

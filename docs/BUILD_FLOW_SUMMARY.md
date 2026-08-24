---
title: Grace Booth MVP — Build Flow, Fixes, and Remaining Work
aliases:
  - Grace Booth Build Summary
  - Photobooth System Build Flow
tags:
  - grace-booth
  - photobooth-system
  - electron
  - supabase
  - cloudflare-pages
  - build-log
status: MVP implemented; deployment and hardware gates remain
created: 2026-08-18
updated: 2026-08-18
---

# Grace Booth MVP — Build Flow, Fixes, and Remaining Work

> [!summary]
> Grace Booth is implemented as an offline-first Windows Electron kiosk with a deterministic mock camera, encrypted local persistence, private Supabase/R2 delivery, and a Cloudflare Pages-hosted public download page. The unsigned Windows installer and unpacked application were built and verified. No automatic Supabase, Cloudflare Pages, DNS, camera SDK, or other hosted mutation is performed by the repository. Real Sony capture, live cloud validation, production signing, and testing on a supported production Windows host remain gated.

## 1. Starting point and controlling decisions

The workspace initially contained only `CODEX_BUILD_PROMPT.md` and `SETUP.md`; it was not, and still is not, a Git repository. The controlling prompt was preserved unchanged. Its recorded SHA-256 is:

`0ED374E20E334172092BCE694B61120F5B8164DCE93DD8A36762F29F8D48B1CB`

All canonical architecture and UI references were read before implementation. The resulting monorepo contains:

- `apps/kiosk` — Electron kiosk, guest UI, local admin, SQLite state, encrypted media, image worker, upload queue, and Windows packaging.
- `apps/public` — static React page for Cloudflare Pages, using a URL fragment for the bearer token and POST-only photo APIs.
- `packages/shared` — strict Zod contracts for state, camera, frames, cloud APIs, snapshots, and IPC.
- `supabase` — SQL migrations, private Storage policy, Edge Functions, cleanup scheduling, pgTAP tests, and Deno tests.
- `tests/e2e` — public-page, visual, and real Electron acceptance journeys.
- `docs` — security/retention, verification, and Sony integration gates.

Pinned foundation: Node 24, pnpm 11, Electron 43.4, electron-vite 5, Vite 7.3, React 19.2, TypeScript 6, Fastify 5.12, better-sqlite3 13, and Sharp 0.35.

## 2. Implementation flow

### Phase 0 — Foundation and security baseline

✅ Phase 0 — workspace, shared contracts, and the Electron trust boundary completed.

- Created the pnpm monorepo, strict TypeScript, formatting, linting, Vitest, Playwright, checked-in lockfile, and packaging configuration.
- Made Electron main authoritative for countdowns, transitions, camera calls, persistence, processing, uploads, QR readiness, admin authentication, and cleanup.
- Restricted the renderer to a fixed typed preload API. It has no generic IPC, filesystem, database, Electron, process, shell, or direct Supabase access.
- Added sandboxing, context isolation, restrictive CSP, sender/schema validation, denied permissions/navigation/windows/downloads, secure custom protocols, and hardened Electron fuses.
- Added local fonts, SVG icons, deterministic mock photos, attract/recovery artwork, audio, and a transparent default frame. The production renderer makes no third-party asset requests.
- Added first-run operator bootstrap with an 8–64 character passcode and no default PIN.

### Phase 1 — Guest UI and deterministic mock flow

✅ Phase 1 — all seven top-level artboards and the complete mock guest journey completed.

- Implemented Attract, Capture, Review, Processing, Final QR, conditional Recovery, and Admin.
- Implemented exactly four eight-second captures, honest mock preview copy, audio and flash cues, review, unlimited retake-all, processing milestones, upload states, final QR, and Done reset.
- Kept QR data out of renderer state. The renderer receives locally generated QR pixels and opaque media URLs only.
- Implemented fit-safe layouts at 1366×768 and 1280×720, large targets, keyboard focus, semantic statuses, contrast corrections, and reduced motion that does not alter capture timing.
- Added 11 deterministic development-only visual seeds; production builds exclude the seeder and development QR fixture.

### Phase 2 — Persistence, admin, image pipeline, and recovery

✅ Phase 2 — durable local workflow, admin surfaces, encryption, and image processing completed.

- Added SQLite migrations for settings, sessions, assets/retake rounds, upload jobs, and audit events.
- Added transactional state/job updates, startup reconciliation, interrupted-session recovery, prior retake preservation, and final-state restoration.
- Sealed the installation key, booth Auth session, public tokens, and optional LAN secrets with Electron `safeStorage`.
- Encrypted guest assets using AES-256-GCM and atomic same-directory temporary-write/flush/rename behavior.
- Added a long-lived Sharp worker with signature/decode/orientation checks, 50 MiB and 80 MP limits,
  exactly three face-aware crop/fit slots, frame-last raw-pixel rendering, and one final immutable
  1200×3600 sRGB JPEG encode at quality 95, 4:4:4 chroma, MozJPEG, and 600 DPI metadata.
- Added `CenterCropStrategy` as the deterministic supported path. `MediaPipeCropStrategy` honestly reports unavailable in the Node worker instead of introducing an unapproved hidden renderer or native bridge.
- Added Frame Editor and Admin Settings, including exact-1:3 transparent PNG frames, exactly three
  normalized slots, queue retry, passcode changes, optional Google Forms URL, health, and fixed
  retention display.
- Added loopback-only Fastify administration. Optional LAN administration remains disabled unless a private interface and operator-provided HTTPS PFX are configured.

### Phase 3 — Supabase/R2 delivery and Cloudflare Pages public page

✅ Phase 3 — cloud contract and deployable source completed; no hosted resources were created.

- Added `booth_devices` and `photo_sessions`, ownership/idempotency fields, hash-only token storage, opaque object paths, expected JPEG metadata/hash, status, timestamps, and RLS.
- Denied direct anonymous and authenticated table/Storage access; Edge Functions alone use the server secret.
- Added `create-upload`, `confirm-upload`, POST-only photo resolution/image/download actions, and idempotent leased cleanup.
- Added exact expiry at confirmation time plus 720 hours, independent of later cleanup timing.
- Added the Cloudflare Pages public page. QR targets are `https://<public-origin>/photo#<token>`, so the fragment
  does not reach access logs. The page sends the token only in validated POST bodies and follows
  authenticated bodyless 303 delivery redirects only to the configured private R2 S3 API origin.
- Added exact-origin CORS, no-store behavior, restrictive CSP, no analytics, and no third-party public-page requests.
- Added a separate server-only `PUBLIC_TOKEN_DERIVATION_KEY` for stable, domain-separated HMAC-SHA256 token derivation across concurrent or lost-response retries. PostgreSQL stores only SHA-256 of the derived raw token.
- Locked production Supabase region documentation to Singapore.

### Phase 4 — Hardening, verification, and Windows packaging

✅ Phase 4 — queue hardening, acceptance coverage, documentation, and unsigned Windows packaging completed.

- Added FIFO concurrency one, leases, initial upload plus exact 1/3/8-second retries, transient/permanent classification, Auth-paused jobs, manual retry cycles, startup recovery, local cleanup tombstones, and Pino redaction.
- Added the explicit unsupported Sony adapter boundary and `docs/SONY_CAMERA_INTEGRATION.md`.
- Added Electron Builder NSIS x64 packaging, unpacked Sharp/better-sqlite3, ASAR integrity, secure fuses, packaged resources/migrations, and packaged native self-testing.
- Added `README.md`, updated authorized `SETUP.md`, `.env.example`, scoped deployment instructions, security/retention operations, and `docs/VERIFICATION.md`.

### Phase 5 — Laptop camera, portrait frame, and resizable window

✅ Phase 5 — webcam capture, the new default frame, and a resizable/maximized window completed.

- Added `WebcamCameraAdapter` as the default adapter. The guest renderer owns one `getUserMedia` stream that drives both the live viewfinder and capture; `RendererFrameBroker` keeps main authoritative over when a photo is taken, how long it may take, and whether the returned JPEG is acceptable. `MockCameraAdapter` and the gated `SonyCameraAdapter` are unchanged.
- Narrowed the browser permission surface instead of widening it: `media` is granted only to the kiosk's own origin and only for video, device permissions are denied outright, and the CSP change is limited to `media-src`.
- Replaced the default frame with the portrait PhotoBooth design at 3375 x 4219, punched its four photo slots to full transparency, recalibrated `DEFAULT_FRAME_SLOTS` against the cutouts, moved the import aspect gate from 3:2 landscape to the 4:5 portrait ratio, and made an auto-imported default refresh itself when the packaged artwork changes.
- Made the kiosk window resizable and maximizable, opening maximized in development and fullscreen when packaged, and removed the fixed 1024x640 layout floors so the UI fits smaller windows and scales up on 1080p and larger displays.

## 3. Runtime guest and delivery flow

1. On first launch, the operator must create a local 8–64 character passcode.
2. The guest starts from Attract.
3. Electron main connects the selected camera adapter. The default is `WebcamCameraAdapter` for the laptop or system camera; `MockCameraAdapter` provides the deterministic fixture path.
4. Four main-process-controlled eight-second countdowns produce four JPEG captures.
5. The guest reviews all four and either retakes the complete set or accepts it.
6. The Sharp worker validates/decrypts inputs, crops four slots, composites the frame last, writes the JPEG locally, and encrypts it atomically.
7. The upload queue asks `create-upload` for an opaque path, stable bearer token, and two-hour upload capability.
8. Electron seals the raw token immediately; the signed upload capability stays in memory only.
9. The collage uploads to private Storage.
10. `confirm-upload` verifies owner, token, bytes, JPEG signature, dimensions, type, size, and SHA-256 before returning an immutable ready receipt.
11. Only `QrService` accepts a ready receipt, structurally preventing QR generation before confirmation.
12. The guest scans `https://<public-origin>/photo#<token>`.
13. The public page POSTs the token to controlled resolve/image/download endpoints. Public access ends exactly 720 hours after readiness.
14. Done clears guest/session UI and returns focus to Start. Local originals, retake rounds, previews, and collages remain encrypted for the fixed 60-day local retention period.

## 4. Errors and constraints encountered, and how they were fixed

| Encountered issue                                                                                           | Impact                                                                                                       | Resolution                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Default Supabase Edge Function URLs rewrite HTML responses to plain text.                                   | A branded public HTML page could not be served from the locked default Function URL.                         | Uses a static Cloudflare Pages public page; Supabase remains a POST-only private-media API.                                                                                                  |
| Supabase-managed logs record request paths.                                                                 | A raw token in `/photo/<token>` would leak into infrastructure logs.                                         | Moved the token to the URL fragment and strict POST bodies. Paths and query strings contain no token.                                                                                        |
| Electron 43/electron-vite 5 compatibility did not align with Vite 8.                                        | Initial dependency choice could have produced an unsupported build stack.                                    | Pinned Vite 7.3. better-sqlite3 13 and Sharp 0.35 were selected for available Windows x64 prebuilds.                                                                                         |
| The workstation lacks Python and Visual C++ build tools.                                                    | Native modules could fail if local compilation were required.                                                | Used native-module versions with Windows x64 prebuilds and added development and packaged native self-tests.                                                                                 |
| Official MediaPipe Tasks Vision is browser/Web-oriented and the Node worker lacks the required canvas APIs. | Face-aware crop could not be honestly supported in the locked worker architecture.                           | Kept a `MediaPipeCropStrategy` capability boundary that reports unavailable and deterministically falls back to center crop.                                                                 |
| Vitest 4 removed `environmentMatchGlobs`.                                                                   | Kiosk test configuration initially failed typechecking.                                                      | Removed the obsolete option; Node is the default and renderer tests use an explicit happy-dom environment where needed.                                                                      |
| Guest upload recovery exposed `canRetryUpload` but the bridge lacked a matching action.                     | The UI could show retry availability without a callable guest path.                                          | Added a guest-scoped typed `booth:retry-upload` IPC contract returning a sanitized snapshot.                                                                                                 |
| Public production builds could silently retain inert hosted origins.                                        | A deployment could ship a CSP that cannot reach the approved API or private R2 bucket.                       | Production Vite validates the origins and emits exact Cloudflare Pages headers; development and test mode retain isolated fixtures.                                                          |
| Root Playwright sources were outside strict TypeScript/ESLint project coverage.                             | Root lint and typecheck could fail or silently omit E2E code.                                                | Included `playwright.config.ts` and `tests/e2e/**/*.ts` in the root strict TypeScript project and ESLint project service.                                                                    |
| The initial test plan had browser/visual tests but no real Electron project.                                | Guest workflow, retries, restarts, bootstrap, and QR gating were not exercised in the packaged architecture. | Added a `kiosk-electron` Playwright project with seven Electron journeys, including real timing and phase-by-phase process exits.                                                            |
| Native self-test originally exercised only development Electron.                                            | Packaging could still omit or break Sharp/better-sqlite3.                                                    | `dist:win` now runs the unpacked `Grace Booth.exe --native-self-test`; all native checks pass in the packaged executable.                                                                    |
| Window permission/download handlers were initially registered after renderer loading.                       | The first document load had a small policy-registration gap.                                                 | Registered window, permission, download, navigation, and webview denial handlers before `loadURL`.                                                                                           |
| Concurrent upload creation originally risked rotating tokens and invalidating a returned token.             | Lost-response or overlapping retries could produce a dead QR token.                                          | Replaced per-call rotation with stable domain-separated HMAC derivation for each owner/client-session idempotency key.                                                                       |
| Confirmation originally had a token-validation/finalization time-of-check/time-of-use race.                 | A token could change between validation and finalization.                                                    | Moved authoritative token/ownership/cleanup-state validation into the locked database finalization boundary.                                                                                 |
| Cleanup could lease a stale pending row while confirmation finalized it.                                    | Cleanup could delete an object after a successful ready receipt.                                             | Added cleanup lease state and made finalization refuse leased rows; cleanup completion is lease-bound and idempotent.                                                                        |
| SQL initially used `interval '30 days'`.                                                                    | In a non-UTC/DST-sensitive session, this could violate the exact 720-hour invariant.                         | Replaced it with `interval '720 hours'` and added database/integration assertions for the exact epoch delta.                                                                                 |
| Processing labels could imply a milestone had already completed.                                            | UI status could be misleading.                                                                               | Changed milestones to neutral actions: “Build collage”, “Upload and verify”, and “Prepare QR”.                                                                                               |
| A small-text outline color and success-container text missed the desired contrast.                          | WCAG-AA visual acceptance risk.                                                                              | Moved normal/small copy to `#434653` and added a darker success-container foreground.                                                                                                        |
| Admin LAN control inherited generic input sizing.                                                           | The checkbox appeared as an oversized browser-default square.                                                | Implemented an accessible 44×24 `role=switch` with checked, focus, reduced-motion, and forced-colors behavior.                                                                               |
| Partial capture recovery initially had no direct guest action.                                              | An interrupted partial round could appear stuck.                                                             | Startup reconciliation now converts a partial round to `camera_error`, preserves its assets, and exposes the passcode-gated operator restart path.                                           |
| Documentation initially omitted or overstated several details.                                              | Setup could mislead operators about credentials, region, verification, and server secrets.                   | Added the verification record, explicit Singapore prerequisite, transient form-credential wording, `PUBLIC_TOKEN_DERIVATION_KEY`, supported Windows warning, and packaged test instructions. |

## 5. Verification completed

The authoritative verification record from 2026-08-18 reports:

| Check                                             | Recorded result                                           |
| ------------------------------------------------- | --------------------------------------------------------- |
| Frozen dependency install                         | Pass                                                      |
| Formatting                                        | Pass                                                      |
| Lint                                              | Pass                                                      |
| Strict typecheck                                  | Pass                                                      |
| Unit/integration helper tests                     | Pass — 95 tests                                           |
| Production builds                                 | Pass                                                      |
| Playwright acceptance                             | Pass — 33 tests                                           |
| Visual matrix                                     | Pass — 22 locked screenshots plus reduced-motion coverage |
| Development native self-test                      | Pass                                                      |
| Windows x64 NSIS package                          | Pass                                                      |
| Packaged native self-test                         | Pass                                                      |
| Local Supabase database/live Function integration | Gated — container runtime absent                          |

The 33 Playwright checks include the public page, 11 UI states at two target resolutions, reduced motion, and seven Electron journeys. Electron coverage includes bootstrap/re-lock, happy path, two complete retake rounds, four real eight-second countdowns, camera recovery, exact 1/3/8-second retry exhaustion and manual recovery, restart during create/upload/confirm, final restoration after more than ten minutes, and Done reset.

The checked-in pgTAP suite contains 60 assertions. The live Function integration source covers allow-listing, ownership, direct-access denial, concurrent idempotency, signed upload, validation, atomic confirmation, exact expiry, CORS/routes, controlled streaming, expired-token equivalence, and repeated cleanup.

### Windows artifact

- Installer: `apps/kiosk/release/Grace-Booth-0.1.0-x64-setup.exe`
- Size: 133,341,830 bytes
- SHA-256: `CEB7A9554FC22B8231AA2C89A25BF6E9333492081ADCB80EC5E7D8390E8FA303`
- Unpacked executable: `apps/kiosk/release/win-unpacked/Grace Booth.exe`
- Status: unsigned, internal verification only

### Fresh audit note for 2026-08-18

A fresh run in the current restricted Codex session reconfirmed formatting, lint, and strict typechecking. The subsequent public Vitest startup was blocked when esbuild attempted to inspect `C:\Users\padil\mj`, which this session is not permitted to read outside the workspace. The error was `Access is denied` while resolving `apps/public/vite.config.ts`. This is a sandbox/environment restriction and does not supersede the earlier complete 95-test pass on the same source tree.

## 6. Problems not yet fixed or intentionally gated

> [!warning]
> These are not hidden code failures. They require infrastructure, hardware, release credentials, or an explicit architecture decision that was outside the authorized implementation scope.

### Cloud and deployment

- No Supabase project has been created. Production must use the locked Singapore region.
- Supabase migrations, private Storage, Vault values, Cron/`pg_net`, booth identity allow-listing, and Edge Functions have not been deployed.
- No Cloudflare Pages deployment, production-origin change, or DNS mutation is performed automatically.
- Hosted CORS/origin and end-to-end cloud smoke tests cannot run until both services exist.
- Production builds fail closed unless `VITE_PUBLIC_PHOTO_API_URL`, `VITE_PUBLIC_PAGE_ORIGIN`, and
  the actual presigned S3 `VITE_PUBLIC_R2_ORIGIN` are set. The build emits the exact Cloudflare
  Pages CSP and SPA routing into `apps/public/dist`.
- `PUBLIC_TOKEN_DERIVATION_KEY`, `CLEANUP_SECRET`, Supabase server keys, and Vault values must be generated and stored operationally; none are included in the repository.

### Database/live Function testing

- Docker Desktop and Podman are absent, so `supabase db reset`, the 60 pgTAP assertions, and the live local Function integration suite have not executed against a running local stack.
- Static checking and helper tests pass, but database-backed acceptance remains a release gate once a container runtime is available.

### Camera and crop capability

- Real Sony capture is not implemented. `SonyCameraAdapter` intentionally returns `unsupported_pending_model_verification`.
- Enabling Sony requires the exact camera body and firmware, official SDK evidence, redistribution approval, USB capture/byte-transfer validation, installer validation, and a twenty-capture soak test.
- Face-aware MediaPipe cropping is not active in the Node worker. The MVP uses deterministic center crop. Adding a supported detector runtime or bridge requires a new architecture decision.

### Windows release operations

- The installer is unsigned. Production requires an Authenticode certificate and signing workflow.
- The current workstation is Windows 10 build 19045, past standard support. Production must use Windows 11 or active Windows 10 ESU.
- Installed/uninstall behavior should be validated on a clean, supported Windows 11 operator account.
- Optional LAN administration has not been production-tested with the operator’s real private interface, HTTPS PFX, certificate identity, or firewall rule. Loopback administration is the supported default.

### Repository and operational readiness

- The folder is still not a Git repository, so there is no commit history, branch protection, release tag, or reproducible source-control checkpoint. Initialize Git and create a reviewed baseline before further deployment work.
- No real production secrets, guest data, or hosted credentials should be added to source control.
- Physical booth acceptance, printer/USB/power behavior if later introduced, network-loss soak testing, and venue operating procedures remain outside the software-only build.

## 7. Recommended next sequence

1. Initialize Git, review the complete source, and record a clean baseline without generated secrets.
2. Move production testing to Windows 11 or an ESU-covered Windows 10 machine.
3. Install Docker Desktop, run the Supabase reset, execute pgTAP and live Function integration, and retain the results.
4. Obtain approval to provision Supabase in Singapore and deploy the existing Cloudflare Pages project.
5. Generate server-only secrets, create a dedicated booth Auth identity, allow-list it, deploy migrations/Functions, configure Vault/Cron, and deploy the public page with the exact CSP.
6. Run hosted-origin, CORS, expiry, upload, restart, and cleanup smoke tests using non-production fixtures.
7. Decide and implement Authenticode signing, then validate install/uninstall on a clean supported Windows account.
8. Identify the exact Sony model/firmware and follow `docs/SONY_CAMERA_INTEGRATION.md`; do not enable the Sony adapter before that gate passes.
9. Perform a physical booth soak test covering camera disconnects, network interruption, full retake cycles, upload recovery, restart at each phase, retention cleanup, and operator recovery.

## 8. Key references

- `CODEX_BUILD_PROMPT.md` — unchanged controlling brief
- `README.md` — system overview and commands
- `SETUP.md` — local, cloud, packaging, and operational setup
- `docs/VERIFICATION.md` — authoritative workstation verification record
- `docs/SECURITY_AND_RETENTION.md` — trust boundaries, secrets, retention, and incident response
- `docs/SONY_CAMERA_INTEGRATION.md` — real-camera stop gate
- `supabase/README.md` — cloud deployment contract
- `apps/public/README.md` — Cloudflare Pages/public-page setup

## 9. Bottom line

The software MVP is built and packaged around the mock camera path. The major implementation and concurrency/security defects found during the build were corrected and covered by tests. What remains is chiefly deployment validation, real Sony hardware integration, production signing, supported-OS qualification, and source-control/release operations—not unfinished hidden guest-flow code.

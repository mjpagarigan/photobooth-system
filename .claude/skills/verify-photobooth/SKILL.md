---
name: verify-photobooth
description: Drive the M.A.T. Photobooth the way a guest or operator does and capture proof. Covers the Electron kiosk (apps/kiosk) end to end through Playwright with the mock camera, Screen 2 through its renderer fixture, and the guest download page (apps/public) with a mocked photo API. Use it to prove a UI or workflow change works, to reproduce a kiosk bug, or to capture before/after screenshots of every screen.
---

# Verify the photobooth

The harness is a Playwright config plus journey specs in this folder. Each journey launches the real app, acts through accessible names and test IDs, and writes a screenshot and an ARIA snapshot per step. Run every command from the repo root.

## Surfaces

| Surface                                 | How it is driven                                                                                      | How real it is                                                                                                   |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Kiosk Screen 1, operator dialogs, admin | Built Electron app via Playwright `_electron`, `GRACE_BOOTH_E2E=1`, `GRACE_BOOTH_CAMERA_ADAPTER=mock` | Real main process, IPC, SQLite, image worker. Camera and cloud delivery are the deterministic E2E adapters.      |
| Screen 2 (QR station)                   | Kiosk renderer on Vite at `http://127.0.0.1:4174/?view=qr-station&visual=qr-station-active`           | Fixture data in the real component. No IPC. Real dual-display needs two physical monitors.                       |
| Guest download page                     | `apps/public` on Vite at `http://127.0.0.1:4173/photo#<token>` in `--mode test`                       | Real page. The photo API at `https://api.example.test` is mocked with `page.route`; every other host is blocked. |

## Launch

1. Build the kiosk once per source change: `pnpm build:kiosk`. The Electron journeys run `apps/kiosk/out/main/index.js`, so a stale build tests old code.
2. Run the doctor (below). It must print `READY`.
3. Run journeys:

```bash
pnpm exec playwright test -c .claude/skills/verify-photobooth/playwright.config.ts
```

- One project: add `--project=kiosk`, `--project=screen2` or `--project=public`. Use the `=` form; a bare `--project kiosk kiosk-guest` reads `kiosk-guest` as a second project.
- One journey: add a file filter, such as `--project=kiosk kiosk-guest`.
- Ready means: the config starts both Vite servers (`[WebServer]` lines), then each Electron journey waits until `renderer-loading` is gone. A journey that passes its first `expect` reached a usable app.

Each Electron journey creates its own `%TEMP%\grace-booth-verify-*` user-data directory, so every run starts from first launch: empty database, operator passcode not yet created, migrations applied by the app. The journeys create the passcode `grace-verify-2026` in that throwaway directory.

## Doctor

```bash
node .claude/skills/verify-photobooth/scripts/doctor.mjs
```

Read-only. Checks Node 24, that `apps/kiosk/out` exists and is newer than `apps/kiosk/src`, that Playwright is installed, and that ports 4173 and 4174 are free. Run it first, and again whenever a journey fails before its first step.

## Drive

Journeys live in `journeys/`. Shared helpers are in `journeys/harness.ts`:

- `launchKiosk(envOverrides)` starts Electron with a fresh user-data dir. Overrides are the `GRACE_BOOTH_E2E_*` variables in `apps/kiosk/src/main/config.ts`: `COUNTDOWN_MS` (10 to 5000, default 40), `CAMERA_DELAY_MS`, `CAPTURE_FAIL_SHOT` (1 to 3), `UPLOAD_FAILURES` (0 to 4; 4 exhausts the 1/3/8 second retries), `CREATE_DELAY_MS`, `UPLOAD_DELAY_MS`, `CONFIRM_DELAY_MS`, `NOW_MS`.
- `bootstrap(page)` creates the operator passcode and waits for `attract-screen`.
- `capture(page, feature, step)` writes `<feature>/<step>.png` and `<feature>/<step>.aria.yml` into the evidence directory.
- `closeKiosk(kiosk)` closes the app and deletes only its own user-data dir.

Stable handles, in order of preference: role plus accessible name (`Start photo session`, `Retake all photos`, `Use these photos`, `Done`, `Finish offline`, `Retry upload`, `Recent Photos`, `Camera Setup`, `Admin`, `Unlock`, `Frame editor`, `Recent photos`, `Settings & health`, `Back to booth`), then test IDs (`attract-screen`, `capture-screen`, `review-screen`, `collage-option-N`, `processing-screen` with `data-state`, `final-screen`, `recovery-upload`, `recovery-camera`, `recent-gallery`, `admin-shell`, `frame-editor`, `admin-settings`, `qr-station-active`). Passcode fields are `#operator-passcode` and `#operator-passcode-confirmation`.

To add a journey, copy the closest spec in `journeys/`, keep it on the user's path, and add or update its feature file in `features/`.

## Evidence

Evidence goes to `artifacts/verify/<ISO timestamp>/` by default. Set `VERIFY_OUT` to choose the folder, for example `VERIFY_OUT="$PWD/artifacts/verify/after-redesign"`. Each feature gets a folder of numbered steps. Failures add a trace, screenshot and `error-context.md` under `playwright-output/`.

The Fluent design baseline captured before the Apple-style redesign lives in `artifacts/verify/baseline-fluent/`. Never overwrite it. Compare a later run against it screen by screen.

Two scripts compare against the Apple-style prototype, whose artboards live in `artifacts/verify/prototype-apple/` (local, not committed):

- `node .claude/skills/verify-photobooth/scripts/compare.mjs <visual-state>=<Artboard> ...` puts a prototype artboard beside a renderer fixture, for example `review=Review` or `qr-station-active=Screen2Qr`. It needs the kiosk renderer on 4174 (`pnpm --filter @grace-booth/kiosk dev:renderer`) and writes `artifacts/verify/compare/<state>.png`. Stop that server before running journeys, which need the port free.
- `node .claude/skills/verify-photobooth/scripts/triptych.mjs [after-dir]` writes one sheet per screen to `artifacts/verify/compare/final/`: baseline, journey capture, and prototype. It needs no server. Journey captures are 1920x1080 while artboards are 1366x768, so judge layout and hierarchy, not pixel size.

Proof standards:

- Drive the real user path: click the button a guest or operator would click. Do not call IPC or set React state.
- Capture the action and the result, not only the last screen. The numbered steps exist for that.
- Check side effects, not only pixels. The guest journey reads the final collage's natural size into `08-final-collage-size.json`; the public journey asserts the `resolve`, `image`, `download` call order.
- Mocks only at existing production boundaries: the camera adapter, the E2E delivery client, and the public page's photo API. Anything a screen 2 fixture shows is fixture data; never report it as proof of IPC or display routing.

## Cleanup

- Each Electron journey closes its own app and removes its own `grace-booth-verify-*` directory in a `finally`. If Electron fails to open a window, `launchKiosk` removes the directory before rethrowing. Both refuse any path outside that prefix.
- Playwright stops both Vite servers when the run ends.
- If a run is killed mid-way, close only processes this run started. Find them with `netstat -ano | findstr :4173` and `:4174` for Vite, and Electron windows titled for the booth. Never kill `electron.exe` or `node.exe` by name: the user may be running their own booth.
- Stray user-data directories from a killed run: `Get-ChildItem $env:TEMP -Directory -Filter grace-booth-verify-* | Remove-Item -Recurse -Force`.
- Cleanup never touches `artifacts/verify/`.

## When a journey fails

- `firstWindow: Timeout` on the first Electron journey of a run: the Vite servers were still compiling and starved Electron. Rerun; the launch and the first window each allow 60 seconds. If it repeats, run `--project=kiosk` alone after the servers are warm.
- Any timeout: open `error-context.md` under `playwright-output/` first. It holds the page's ARIA tree at the moment of failure, which usually names the state the app was really in.
- An invalid `GRACE_BOOTH_E2E_*` value (outside the ranges above) makes the app fail its config check and never open a usable window.

## Isolation

`reuseExistingServer` is off. If 4173 or 4174 is taken, the run fails instead of driving someone else's dev server. Two harness runs cannot overlap for the same reason. Electron instances do not share data because each gets its own user-data dir.

## Feature map

`features/README.md` is the index of user-facing features and how to prove each. A proof that covers one entry point is incomplete when the map lists others. Keep the map in step with the app with `/pstack:maintain-verification-skill`.

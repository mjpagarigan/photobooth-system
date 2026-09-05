# Wayfinder Map — Grace Booth Fix Batch

Label: wayfinder:map

## Destination

A set of five production-ready, codebase-grounded opencode prompts that fully specify all eight requested fixes, ready to paste and execute one at a time.

## Notes

- Domain: Electron 43 + React 19 kiosk (`apps/kiosk`), Vite SPA (`apps/public`), Supabase Edge Functions + Cloudflare R2 (`supabase/functions`), shared zod contracts (`packages/shared`). pnpm monorepo, deno for functions.
- Target AI tool for all prompts: opencode (agentic CLI, runs in this repo).
- Verification commands every prompt must end with: `pnpm lint`, `pnpm typecheck`, `pnpm test` (+ `pnpm test:e2e` where UI flow changed).
- Standing preferences from grilling: sequenced delivery (5 clusters); Recent viewer lives on FinalQr screen, Attract screen, AND operator panel (operator variant adds metadata); ESC cancel covers both during-capture and after-capture cases.

## Decisions so far

- [ESC semantics](tickets/02-esc-cancel.md): single ESC arms a 2-second confirm hint; second ESC aborts session, purges partial captures, returns to AttractScreen. Valid in every live guest state.
- [Camera lifecycle](tickets/01-camera-lifecycle-and-timers.md): fixes 1+5 unified — fresh acquire-per-capture-window (re-enumerate devices, apply persisted deviceId, fallback chain) replaces persistent stream; solves both battery drain and stale-stream-after-restart.
- [Timers](tickets/01-camera-lifecycle-and-timers.md): per-shot schedule `[8000, 5000, 5000]`; e2e override (40ms) still honored across all shots.
- [Frame data model](tickets/03-dynamic-infinite-frames.md): ordered library supports original-aspect PNGs, 1–10 slots, explicit activation, session-locked shot counts, compatible review filtering, slot layering, and archive-with-fallback behavior.
- [Filename collisions](tickets/05-cloudflare-date-filenames.md): base name `MM-DD-YYYY-HH-MM-SS`; on collision append `-2`, `-3`, … Timestamp source: kiosk-supplied capture time (validated), server falls back to UTC.
- [Recent viewer backend](tickets/04-recent-photo-viewer.md): new main-process gallery RPC over existing vault/session listing (pattern: `listSessionsWithPublicSecret`); QR per item via existing qr-service.
- [QR image load failure](tickets/06-qr-image-load-failure.md): retryable "We could not open this photo" is a three-layer R2-redirect coherence failure — deployed frontend from HEAD still uses `redirect: 'error'` against the function's new 303, R2 bucket CORS is doc-only (never provisioned), and build-time `VITE_PUBLIC_R2_ORIGIN`/CSP must match the presigned URL origin exactly.

## Not yet specified

- Whether Recent viewer needs privacy scoping (event-day filter) for guest-facing surfaces; currently last-N sessions.
- Per-shot timers possibly becoming operator-configurable later.

## Out of scope

- Sony A7 tether adapter internals (`sony-camera-adapter.ts`) — untouched by this batch.
- Public web page (`apps/public`) redesign beyond nothing — fix 7 resolved kiosk-side.

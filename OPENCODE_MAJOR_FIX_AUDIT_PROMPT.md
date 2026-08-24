# OpenCode Prompt — Photobooth Major-Fix Audit and Repair

```text
You are a senior Electron/React/TypeScript engineer specializing in camera lifecycles, offline-first media workflows, SQLite/Supabase migrations, accessibility, and production UI QA.

## Objective

Diagnose and finish the existing uncommitted implementation of the eight photobooth fixes below. Repair functional, state-management, migration, security, accessibility, responsive-layout, and visual-consistency defects. Do not replace working architecture or redesign the product.

## Context (carry forward)

- Repository: `C:\Users\padil\mj\photobooth-system`
- Stack: Electron 43, React 19, TypeScript, SQLite/Drizzle, Sharp worker, Supabase Edge Functions, Cloudflare R2, Playwright, Vitest, pnpm monorepo.
- The working tree is intentionally dirty and already contains an OpenCode implementation of these features. Treat it as the starting point. Inspect `git status`, `git diff`, `docs/wayfinder/map.md`, and every file under `docs/wayfinder/tickets/` before editing.
- NEVER reset, discard, overwrite, or re-create the existing work wholesale. Preserve unrelated user changes.
- Existing visual identity is the dark “Urban Loft” industrial system in `apps/kiosk/src/renderer/styles.css`. This is a polish pass, not a redesign.
- Only make changes directly required by this brief. Do not add unrelated features, abstractions, dependencies, or files.

Current verification baseline (re-run; do not assume it is still current):

- `pnpm --filter @grace-booth/kiosk typecheck` passes.
- `pnpm --filter @grace-booth/kiosk test` passes: 23 files / 116 tests.
- `pnpm lint` passes.
- `pnpm test:functions` passes: 19 tests.
- `pnpm test:e2e -- tests/e2e/kiosk-visual.spec.ts` fails: 10 failed / 20 passed.
- `pnpm format:check` already fails across 25 files, including unrelated baseline files. Format every file you touch, but do not mass-format unrelated files merely to make this command green.

Known defects to reproduce and verify, not blindly accept:

1. Cancelling while a renderer frame request is in flight can leave `RendererFrameBroker.pending` and the webcam adapter busy until timeout, so the next session can fail.
2. `FrameEditor.tsx` delete buttons call a handler that deletes `selectedFrame`, not necessarily the row whose Trash button was pressed.
3. The operator Recent view closes by setting `recent.open=false`, then `App.tsx` immediately auto-opens it again. Guest and operator presentations are incorrectly coupled as one modal.
4. `RecentGalleryService` rebuilds a preview from current captures/frame data instead of reading the immutable stored collage asset. Historical previews can change after a frame edit.
5. The Final-screen Recent button is a third grid child and renders below the photostrip, not beside/inside the QR action area.
6. The Frame Library workspace has three children but only a two-column grid, producing broken alignment and pushing the inspector below the main editor.
7. New gallery/library CSS mixes white surfaces with the dark token system, uses undefined `--color-focus` and `--color-terracotta`, lacks coherent icon-button styling, and causes invisible/low-contrast content.
8. Playwright reports serious WCAG contrast failures for `.frame-library__meta` and `.frame-library__hint` (3.37:1 at 12px).
9. The new date-based object path conflicts with the existing Supabase `photo_sessions_storage_object_path_shape` constraint, which still accepts only the legacy `YYYY/MM/<uuid>.jpg` shape. The edge-function unit test does not catch the production RPC failure.
10. R2/Supabase collision selection is a non-atomic check-then-use flow. Concurrent same-second uploads can select the same key; the suffix loops also return an unprobed final candidate and silently ignore Supabase list errors.
11. The countdown hook can briefly reuse the previous shot's displayed value when a new deadline arrives.
12. The Recent modal has no complete focus trap/restoration/inert-background behavior, and underlying guest actions remain reachable.
13. Dynamic-frame tests exercise three options at component level but do not prove responsive behavior for 1, 3, or 20 frames. The current fixed two-column, full-height card CSS cannot safely represent an unbounded library.

## Execution contract

1. Diagnose first. Trace each requirement across shared schemas, main process, preload/IPC, renderer, persistence, backend, and tests. Produce a concise root-cause checklist before editing.
2. Make a dependency-ordered implementation plan, then execute it without waiting unless a Stop Condition is reached.
3. Work in bounded checkpoints: camera/cancel/timers; frame library; recent viewer; cloud naming; UI polish and verification.
4. After each checkpoint, print `DONE: <result> — <files changed> — <tests run>`.
5. Re-read the final diff and remove accidental churn, dead compatibility code, debug output, unused imports, and one-off styles that should use existing tokens.

## Scope

Work only where required inside:

- `apps/kiosk/src/main/camera/`
- `apps/kiosk/src/main/workflow/`
- `apps/kiosk/src/main/frame/`
- `apps/kiosk/src/main/gallery/`
- `apps/kiosk/src/main/database/`
- `apps/kiosk/src/main/ipc/`, `apps/kiosk/src/main/index.ts`, and `apps/kiosk/src/preload/`
- `apps/kiosk/src/renderer/`
- `apps/kiosk/migrations/`
- `packages/shared/src/`
- `supabase/functions/`, `supabase/migrations/`, and their tests
- `tests/e2e/` and relevant `apps/*/tests/`
- Existing Wayfinder docs only when recording verified resolutions

Do not touch `.env`, credentials, production endpoints/keys, unrelated infrastructure, lockfiles, packaged artwork, or historical guest media. Do not commit or push.

## Required outcomes

### A. Webcam lifecycle and recovery (requirements 1 and 5)

- Acquire the webcam only for an active picture-taking window (`countdown`/`capturing`) and Camera Setup while that modal is open.
- Stop every media track on review, processing, final, attract, recovery/error, cancellation, modal close, and unmount. No webcam LED or powered stream may remain active in the background.
- Starting or operator-restarting a failed session MUST re-enumerate devices and reacquire a fresh stream without requiring Camera Setup to be saved again.
- Try the persisted device ID first; if it disappeared, fall back deterministically to an available video input/default camera and surface that fallback to the operator without silently corrupting the saved preference.
- Handle `devicechange`, track `ended`, acquisition races, stale promises, and bounded retries with abortable cleanup. Do not leak tracks from stale attempts.
- Main-process “camera connected” state MUST reflect renderer stream readiness, not merely that the frame broker has a sender. Do not let a countdown finish into a frame request before a usable video frame exists. Add the narrowest readiness/preflight handshake consistent with the current IPC architecture.
- Cancelling or losing the camera during an in-flight request MUST settle/abort the broker request immediately and clear adapter busy state. A new session started immediately afterward must capture normally.
- Preserve mock and Sony adapter behavior; do not change Sony tether internals.

Acceptance tests must cover unavailable camera -> restart/re-enumeration -> successful capture without re-saving settings; missing persisted device -> fallback; stream release on every exit path; device removal/reappearance; stale acquisition cleanup; cancel during an unresolved frame request -> immediate successful next session.

### B. ESC cancellation (requirements 3 and 4)

- Preserve the Wayfinder decision: first Escape arms a visible “Press ESC again to cancel” hint for two seconds; second Escape within that window cancels.
- Support countdown, in-flight capturing, between shots, and Review before acceptance.
- Modal/dialog Escape behavior has precedence. Recent Gallery, Passcode, and Camera Setup must consume Escape without arming/cancelling the guest session below them.
- Cancellation must be race-safe and idempotent: stop timers/stream, abort pending frame work, purge only the active session's partial vault assets and database rows, leave completed/history sessions untouched, return to Attract, and allow an immediate new session.
- The hint needs a coherent status style, readable contrast, and no pill treatment unless it is intentionally retained as a compact status badge.

### C. Per-shot timers (requirement 6)

- Production schedule is exactly `[8000, 5000, 5000]` for shots 1, 2, and 3.
- Keep the accelerated E2E override across all three shots.
- Use one authoritative schedule across main and renderer. Remove obsolete global five-second assumptions and prevent a one-frame flash of the prior countdown value when the deadline changes.
- Verify displayed numbers, audio cues, retake behavior, recovery restart, and all three deadline transitions.

### D. Unbounded dynamic frame library (requirement 2)

- Frames are an ordered, array-backed library keyed by `frameId`, not a hardcoded two-item tuple or `optionIndex`.
- Operator can add validated transparent 1:3 PNGs, rename, edit exactly three slots, reorder, and delete when safe. Existing packaged MAT/Anniversary frames remain the first seeded entries on upgrade.
- A successfully added frame MUST appear automatically in Review without a code change or restart.
- Fix row-targeted delete confirmation so the exact clicked frame is selected/confirmed/deleted. Disable or serialize Add/Save/Move/Delete while mutations are pending; provide clear loading, success, conflict, error, empty, and deletion-blocked states.
- Preserve historical integrity: a frame referenced by a saved session cannot be destructively deleted. Frame updates must not alter already-generated collage media.
- Audit all legacy seams (`getFrameOptions`, `selectedOption`, `collage2FrameId`, optional `frames`, tuple types, local admin server) and either migrate them to the single library truth or retain narrowly documented backward compatibility. Do not leave two divergent sources of truth.
- Make database/import/repoint/delete operations transactional where partial failure could orphan rows or encrypted files. Clean up replaced frame files safely.
- Review UI must handle 1, 2, 3, 20, and more frames without overflow or microscopic previews. Use a restrained scroll/carousel/grid appropriate to the existing kiosk, roving radio tabindex, arrow-key navigation, Enter/Space selection, visible focus, and automatic scroll-to-selected.

### E. Recent photo viewer (requirement 7)

- Keep the Wayfinder scope: kiosk Final QR, Attract, and operator surfaces. Do not add an unauthenticated event-wide listing API to `apps/public` or weaken the token-based download security model.
- On Final, place Recent beside the QR actions/panel as requested; it must not become a detached third grid item below the photostrip.
- Guest presentation is a true modal with focus entry/trap/restoration, inert/hidden background, Escape precedence, scroll containment, and loading/empty/error states.
- Operator Recent Photos is an inline admin page, not the same modal overlay. Closing a guest modal must not trigger the operator auto-open loop.
- Each item shows the exact stored final collage and its own valid QR. Read/decrypt the session's persisted `collageAssetId` and make a thumbnail; NEVER recompose history using the current frame artwork/layout.
- Operator view adds captured time, photo count, frame, upload status, expiry, and working retry state. Guest view omits sensitive/internal metadata.
- Do not expose `publicToken` over IPC if the renderer does not need it. Bound concurrency/memory for 20 thumbnails and tolerate one corrupt/missing session without failing the list.
- Add component, main-process, integration, accessibility, and visual fixtures for guest recent and operator recent.

### F. Date-based Cloudflare/Supabase object names (requirement 8)

- New object path format: `MM-DD-YYYY/MM-DD-YYYY-HH-MM-SS.jpg`, derived from the validated kiosk capture instant. Use UTC consistently per the current Wayfinder decision; invalid/missing input falls back to server UTC.
- Same-second collisions append `-2`, `-3`, and so on before `.jpg` without overwriting any object.
- Allocation MUST be atomic under concurrent requests. Use the database's unique storage-path reservation/retry (plus storage checks where useful); do not rely only on R2 `HeadObject` or Supabase list-before-use.
- Add a new forward migration for already-deployed databases. Update the storage-path check constraint so it accepts both legacy UUID paths already stored and the new date-based paths. Preserve the unique index and all existing rows.
- Never return an unprobed/known-taken candidate, never ignore a storage-list/probe error as “available,” and return an explicit retryable failure if a bounded allocation limit is exhausted.
- Preserve idempotency: retrying the same `clientSessionId` returns its original reserved path. Resume, confirm, download, retention, and cleanup continue using the stored path transparently.
- Test exact format, fallback, suffix boundaries, 32+ collisions, concurrent allocation, idempotent retry, R2 and Supabase fallback, new/legacy constraint compatibility, and no overwrite.
- Do not rename or migrate historical cloud objects in this task.

## UI polish and quality floor

Preserve the incumbent dark industrial identity. Apply minimalist discipline to changed surfaces: clear hierarchy, consistent spacing, flat/coherent surfaces, restrained shadows, crisp 4–8px radii, no new gradients, no glassmorphism, no large pills, no emojis, and only the existing Phosphor icon family. Do not perform a global font or palette replacement.

- Replace hardcoded light-theme colors and undefined CSS variables with existing semantic tokens or add a real reusable token when needed.
- Fix the Frame Editor as an intentional three-pane layout at wide widths, with useful collapse/stack behavior at intermediate and portrait widths.
- Audit every touched control in default, hover, focus-visible, active, disabled, loading, error, and success states. Loading actions must prevent duplicate/racing mutations.
- Use a consistent spacing scale and optical alignment for icons, labels, headers, buttons, QR, frame tiles, and metadata.
- Meet WCAG 2.1 AA contrast, logical tab order, screen-reader names, 44px minimum interactive targets where appropriate, zoom/long-copy resilience, and `prefers-reduced-motion`.
- Verify 1280x720, 1366x768, 768x1024, and 1920x1080. No clipped controls, page overflow, detached actions, overlapping text, or unreachable inspector/gallery content.
- Never update a screenshot baseline merely to silence a failure. Inspect expected/actual/diff first; update only after the intended UI is correct. Replace stale two-tab Frame Editor selectors with library-based tests.

## Verification

Add regression tests before or with each fix. At minimum run:

1. Scoped Vitest tests for every changed module.
2. `pnpm --filter @grace-booth/kiosk typecheck`
3. `pnpm --filter @grace-booth/kiosk test`
4. `pnpm test:functions`
5. `pnpm lint`
6. `pnpm typecheck`
7. `pnpm test`
8. `pnpm test:e2e -- tests/e2e/kiosk-visual.spec.ts`
9. Relevant Electron E2E flow tests, including cancellation/restart and dynamic frames.
10. `pnpm format:check`; distinguish new failures from the known unrelated baseline and ensure every touched file is formatted.

After UI changes are complete, run the Impeccable detector exactly once if available:

`node C:\Users\padil\.codex\skills\impeccable\scripts\detect.mjs --json <changed UI targets>`

Perform one batched desktop/portrait screenshot inspection, fix all observed defects together, then one confirmation pass. If real webcam hardware is unavailable, complete deterministic mocked/device-event coverage and clearly list the remaining physical-camera checks.

## Stop conditions

Stop and ask before:

- deleting any file or historical photo/frame/session data;
- adding/upgrading a dependency or changing a lockfile;
- making a destructive database migration or weakening storage/token security;
- modifying production credentials, URLs, deployment settings, or anything outside Scope;
- changing the product's established visual identity instead of polishing it.

## Final response

Return:

1. Root causes found, mapped to requirements 1–8.
2. Files changed and the purpose of each change.
3. Tests/commands run with exact pass/fail counts.
4. Visual/accessibility evidence and viewport coverage.
5. Any remaining hardware/manual verification or unrelated baseline failures.

Do not claim completion while a required regression test, migration compatibility check, visual E2E, or touched-file format check is failing.
```

🎯 Target: OpenCode (agentic coding CLI), 💡 Optimized to audit the existing dirty implementation first, repair the verified cross-process and UI defects in dependency order, and stop only after production-relevant regression coverage passes.

This prompt is for an agentic tool with real system access. Review the scope locks, forbidden actions, and stop conditions before pasting. Confirm that the repository path and permissions match the current project.

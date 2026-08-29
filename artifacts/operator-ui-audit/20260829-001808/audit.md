# Operator Access Redesign Audit

Status: **Awaiting approval — no product source edited**

Timestamp: 2026-08-29 00:18:08 Asia/Manila  
Workspace: `C:\Users\padil\mj\photobooth-system`  
Baseline: `HEAD c5e66af62aa0e4fd3de0cf65b66914d0fdd5c660`, branch `main`, clean working tree

## Safety baseline

- No modified, deleted, or untracked files existed at baseline.
- `baseline/working-tree.patch` and `baseline/forbidden.patch` are intentionally empty.
- The forbidden manifest covers 374 tracked files outside the narrowly allowed frontend paths and records critical group aggregates.
- Supplied screenshots were inspected in place at full resolution. They are not copied into this artifact because one capture visibly contains configuration-like values; the audit records only sanitized observations.
- No dependency, lockfile, IPC, main/preload, backend, cloud, storage, authentication, database, deployment, or production configuration change is proposed.

## Architecture and current implementation

| Surface | Current owner | Current composition | Confirmed gap |
| --- | --- | --- | --- |
| Operator shell | `admin/AdminShell.tsx` | Bespoke `<aside>`, buttons, and CSS | Does not consume the shared Sidebar composition |
| Frame Editor | `admin/FrameEditor.tsx` | Bespoke library controls, native fields/radios, inline delete confirmation | Undersized actions, collapsed inspector fields, underused canvas, no AlertDialog |
| Recent Photos | `components/RecentGallery.tsx` | Bespoke tiles and manual detail-modal focus trap | Fixed cramped grid, weak metadata/status hierarchy, duplicated modal behavior |
| Settings & Health | `admin/AdminSettings.tsx` | One long page with native inputs/selects/checkboxes | Concatenation, extreme scrolling, weak grouping and status structure |
| Camera setup | `components/CameraSetupModal.tsx` | Manual dialog, focus trap, native selects | Duplicated overlay behavior and non-coss form controls |
| Operator access | `components/PasscodeDialog.tsx` | Manual dialog, focus trap, native password controls | Duplicated modal behavior; validation is visually detached |
| Deterministic fixtures | `visual-fixtures.ts` + `App.tsx` | `admin-frame` and `admin-settings` only | No operator access, gallery, degraded, modal, or save/error fixture matrix |
| Shared UI | `packages/ui/**` | Partial local coss/Base UI layer | Fieldset absent; Toast is custom rather than Base UI-backed; Toolbar group/separator and several wrappers need conformance review |

Existing application data flow remains centralized in `App.tsx`; renderer callbacks call the existing bridge without changing IPC shapes. `AdminView` remains `frame | gallery | settings`.

## Sanitized screenshot diagnosis

| Evidence | Surface | Confirmed observations |
| --- | --- | --- |
| `codex-clipboard-0c964813-...png` | Frame Editor | Inspector text and numeric inputs collide; crop radios concatenate; preview is too small for the workspace; reorder/delete controls are ambiguous and below target size |
| `codex-clipboard-99a1a8b0-...png` | Recent Photos | Dense fixed columns, tiny metadata, QR competes with the primary strip, dates and frame names wrap poorly |
| `codex-clipboard-f417f9b6-...png` | Settings top | Health labels join statuses (`CAMERAHEALTHY`); large black sections lack internal structure; device identifier overflows |
| `codex-clipboard-2b46e312-...png` | Settings middle | Native toggles/selects collapse into prose; unrelated settings share one continuous surface; unused horizontal space remains |
| `codex-clipboard-88deb4b3-...png` | Settings bottom | Upload rows concatenate state/attempt data; security/cloud fields collide; configuration-like content is too exposed and difficult to scan |

## Initial findings

| ID | Severity | Surface/state | Viewport | Actual | Expected | Likely source |
| --- | --- | --- | --- | --- | --- | --- |
| OP-01 | P1 | Settings/default | 1280×720 and supplied desktop captures | Labels, controls, and statuses visually concatenate | Distinct field surfaces and semantic status rows | `AdminSettings.tsx`, operator CSS |
| OP-02 | P1 | Frame Editor/default | 1280×720 | Inspector inputs are 24px tall; radio labels concatenate | 44px targets, explicit fields, labeled RadioGroup | `FrameEditor.tsx`, operator CSS |
| OP-03 | P1 | Operator overlays | All | Manual global focus traps duplicate modal behavior | Base UI Dialog/AlertDialog focus containment and restoration | `PasscodeDialog.tsx`, `CameraSetupModal.tsx`, `RecentGallery.tsx` |
| OP-04 | P2 | Settings/default | Desktop | Single page is more than three viewport-heights and lacks progressive disclosure | Six category panels with one deliberate scroll owner | `AdminSettings.tsx` |
| OP-05 | P2 | Frame library/default | 1280×720 | Reorder/delete actions are 32×28px | At least 44×44px with accessible name and Tooltip | `FrameEditor.tsx`, operator CSS |
| OP-06 | P2 | Frame canvas/default | Desktop | Preview uses a small fraction of available workspace | Largest complete aspect-correct preview practical | `FrameEditor.tsx`, operator CSS |
| OP-07 | P2 | Recent Photos/populated | Supplied desktop capture | Fixed three-column tiles compress metadata and de-emphasize the strip | Adaptive grid with primary strip and aligned metadata | `RecentGallery.tsx`, operator CSS |
| OP-08 | P2 | Shared feedback | N/A | Local Toast is a custom global context and anchored manager alias | Documented Base UI-backed coss providers/managers | `packages/ui/src/components/toast.tsx` |
| OP-09 | P2 | Test fixtures | N/A | Only two operator visual seeds; gallery becomes empty when reached from `admin-frame` | Deterministic states for the complete operator matrix | `visual-fixtures.ts`, minimal `App.tsx` integration |
| OP-10 | P3 | Navigation/default | 1280×720 | Navigation buttons measure 42px high | At least 44px, visible focus, current-page semantics | `AdminShell.tsx`, operator CSS |
| OP-11 | P2 | Frame slot tabs/keyboard | 1280×720 | ArrowRight leaves the first tab selected (`aria-selected="true"`) | Arrow keys move selection and focus according to the Tabs pattern | `FrameEditor.tsx` bespoke tab buttons |
| OP-12 | P2 | Existing regression coverage | Baseline test suite | All 49 renderer tests and 8 filtered visual tests pass despite the confirmed target-size, layout, and keyboard defects | Assertions that fail on the observed regressions and deterministic fixtures for missing states | renderer tests, `kiosk-visual.spec.ts`, fixtures |

No P0 defect is confirmed. Moderate/low-impact findings will be reassessed after axe and full keyboard evidence; they are not automatically treated as product defects.

## Live browser evidence

The current deterministic development build was inspected in the in-app browser. Fonts and images were allowed to settle before independent screenshots were written. All primary Frame Editor and Settings captures, the Camera Setup overlay, the empty gallery state, and the supplied screenshots were inspected at full resolution.

| Evidence | Result |
| --- | --- |
| Document overflow | No body-level horizontal overflow at the four audited viewports |
| Settings scroll ownership | `.admin-workspace` is the sole scroll owner at 1280×720; `clientHeight=720`, `scrollHeight=2644` |
| Frame controls | Reorder/delete buttons measure 32×28px; text/numeric inputs 24px high; tab buttons 34.5px high; native radios 13px |
| Shell navigation | Desktop navigation buttons measure 42px high |
| Narrow Frame Editor | Inspector begins below the initial 768×1024 viewport (first inspector input at y=1068.9), requiring substantial scrolling |
| Tab keyboard behavior | ArrowRight on the selected first frame slot did not change selection |
| Delete behavior | First activation enters an inline confirmation state; no `alertdialog` is created |
| Camera dialog | Initial focus lands on Close; Escape closes; focus returns to the opener |
| Operator passcode fixture | Not reproducible through the current visual seed because protected actions return early in fixture mode; this is a fixture-coverage gap, not a security bypass finding |

Machine-readable measurements are in `browser-geometry.json` and `browser-interactions.json`.

### Before screenshot index

- `frame-editor--default--viewport--{1280x720,1366x768,1920x1080,768x1024}.png`
- `settings-health--default--viewport--{1280x720,1366x768,1920x1080,768x1024}.png`
- `settings-health--default--bottom--1280x720.png`
- `recent-photos--empty--default--{1280x720,1366x768,1920x1080,768x1024}.png`
- `camera-setup--open--default--1280x720.png`

Populated gallery, passcode, error, degraded, dirty/save, and popup states are deliberately absent from the before index because the current fixture protocol cannot expose them deterministically without product-source changes.

## Official coss source conformance

Current official documentation and source were checked on 2026-08-29, including `llms.txt`, Sidebar, Tabs, Dialog, AlertDialog, Fieldset, Toast, Toolbar, and the named particles in the brief.

| Primitive | Confirmed current contract | Local disposition |
| --- | --- | --- |
| Sidebar | Provider + Sidebar + Content/Footer/Menu + semantic Inset; mobile uses the shared Sheet; composition uses `render` where polymorphism is needed | Synchronize the required composition and use it in `AdminShell`; avoid importing cookie persistence if the kiosk shell does not need persisted collapse state |
| Tabs | Base UI Root/List/Tab/Panel supplies roving focus and arrow-key semantics; indicator remains within List | Use for settings categories and frame slots; preserve the current values and content state |
| Dialog | Trigger uses `render`; Popup contains Header, Panel, and Footer; form dialogs use `Form className="contents"` | Replace manual overlays/focus traps while preserving controlled state and callbacks |
| AlertDialog | Trigger and actions use `render`; destructive confirmation is contained in the AlertDialog structure | Replace Frame Editor inline delete confirmation |
| Fieldset | Official source wraps `@base-ui/react/fieldset` and exports Fieldset, FieldsetLegend, and the primitive | Add the missing local primitive; installed Base UI 1.7.0 already satisfies it, so no dependency or lockfile edit is required |
| Toast | Official source creates separate Base UI `toastManager` and `anchoredToastManager` instances and mounts providers/portals | Replace the local custom context and manager alias, preserving compatible exports where possible |
| Toolbar | Official Group and Separator are Base UI primitives; `p-toolbar-1` uses `render` composition and tooltips for icon actions | Correct the local plain-div Group/Separator wrappers and use the shared Toolbar for page actions |

No CLI-generated source will be copied blindly. Any approved synchronization will first be dry-run outside the repository and reduced to the minimum compatible diff.

## Baseline automated checks

| Command | Result |
| --- | --- |
| `pnpm exec tsc --noEmit -p packages/ui/tsconfig.json` | PASS (exit 0) |
| `pnpm --filter @grace-booth/kiosk exec vitest run --config vitest.config.ts tests/renderer` | PASS — 6 files, 49 tests, 62s |
| `pnpm exec playwright test --project=kiosk-visual -g "admin-frame|admin-settings|operator frame editor|camera setup"` | PASS — 8 tests, 34.6s |

These passes establish the baseline but also confirm OP-12: the present assertions do not catch the observed visual and interaction defects.

## Proposed information architecture

- Persistent Sidebar: brand, Frame Editor, Recent Photos, Settings & Health, Back to Booth.
- Content inset: page heading/description, Toolbar, and one page-owned scroll region.
- Frame Editor: 280px library, flexible canvas, 360px sticky inspector; stacked sections below the desktop breakpoint.
- Recent Photos: responsive visual grid plus Dialog details.
- Settings tabs:
  1. Overview — subsystem health, camera summary, retention.
  2. Network — LAN access, host, port, TLS certificate selection.
  3. Displays — dual-display mode, swap, QR dismissal.
  4. Google Photos — enablement, connection, album resolution, counters, test/copy actions.
  5. Security & Cloud — passcode and cloud connection forms.
  6. Upload Queue — empty/populated/retrying/failed job states and existing retry action.

## coss adoption and migration matrix

| Intent | Current implementation | Approved target | Verification source/disposition |
| --- | --- | --- | --- |
| App navigation | Bespoke aside/buttons | Sidebar provider/content/menu/footer/inset | Official Sidebar docs; preserve `aria-current` |
| Page actions | Generic button groups | Toolbar/ToolbarGroup/ToolbarButton/Separator | `p-toolbar-1`; correct local wrappers if required |
| Settings categories | One continuous page | Tabs/List/Tab/Panel | `p-tabs-1`; categories only, not route or form state |
| Structured sections | Bespoke black rectangles | Card only for genuinely grouped content | Card docs; plain layout elsewhere |
| Forms | Native forms and labels | Form + Field + Fieldset + Input/Select/Switch/RadioGroup | `p-form-1`, `p-field-4`, `p-select-1`, `p-select-23` |
| Selects | Native `<select>` | Items-first Select/Trigger/Value/Popup/Item | Verify current Base UI 1.7.0 API |
| Modal forms/details | Bespoke modal/focus trap | Dialog with Header/Panel/Footer | `p-dialog-1`, `p-dialog-5`; controlled open state |
| Delete/protected confirm | Inline two-click state | AlertDialog | `p-alert-dialog-1`; focus return required |
| Status | Joined text/custom pills | Badge and persistent Alert | Semantic variants using locked palette |
| Loading/progress | Free text | Skeleton/Progress and Button `loading` | `p-button-41`; use only when state exists |
| Transient feedback | Page status strings/custom toast layer | Base UI-backed `toastManager` | `p-toast-2`, `p-toast-3` |
| Icon actions | Tiny unlabeled visual controls | Button + Tooltip and accessible name | Tooltip never substitutes for `aria-label` |

Intentional retention:

- `react-rnd` remains for frame drag/resize geometry.
- The native add-frame picker remains the existing workflow. No add-frame form/Dialog will be invented; the requested add-frame-dialog screenshot is **not applicable** unless a later product decision changes the workflow.
- Back to Booth currently logs out/exits without confirmation; a confirmation screenshot is **not applicable** because no protected confirmation behavior exists.

## Exact proposed source files

Operator files:

- `apps/kiosk/src/renderer/admin/AdminShell.tsx`
- `apps/kiosk/src/renderer/admin/FrameEditor.tsx`
- `apps/kiosk/src/renderer/admin/AdminSettings.tsx`
- `apps/kiosk/src/renderer/components/RecentGallery.tsx`
- `apps/kiosk/src/renderer/components/CameraSetupModal.tsx`
- `apps/kiosk/src/renderer/components/PasscodeDialog.tsx`
- `apps/kiosk/src/renderer/styles.css`
- `apps/kiosk/src/renderer/visual-fixtures.ts`
- `apps/kiosk/src/renderer/App.tsx` — minimal operator fixture/provider integration; explicit approval requested because it is outside the narrow component directories.

Shared UI files, only where the official-source diff confirms a necessary correction:

- `packages/ui/src/components/fieldset.tsx` (new; no new dependency)
- `packages/ui/src/components/sidebar.tsx`
- `packages/ui/src/components/tabs.tsx`
- `packages/ui/src/components/toolbar.tsx`
- `packages/ui/src/components/toast.tsx`
- `packages/ui/src/index.ts`

Tests and evidence:

- `apps/kiosk/tests/renderer/RendererComponents.test.tsx`
- `apps/kiosk/tests/renderer/PasscodeDialog.test.tsx`
- `apps/kiosk/tests/renderer/CameraSetupModal.test.tsx`
- `apps/kiosk/tests/renderer/App.test.tsx` only for fixture/integration behavior that cannot be isolated
- `tests/e2e/kiosk-visual.spec.ts` and visually approved operator snapshots
- `artifacts/operator-ui-audit/20260829-001808/**`

No manifest or lockfile change is proposed. A temporary coss CLI dry run will occur outside the repository before adding Fieldset or synchronizing a primitive.

## Screenshot and state matrix

Each applicable state will be captured at 1280×720, 1366×768, 1920×1080, and 768×1024, using `<surface>--<state>--<interaction>--<width>x<height>.png`.

| Surface | Required deterministic states |
| --- | --- |
| Operator access | locked, invalid, busy, bootstrap nondismissible, successful shell entry, visibility toggle, focus restoration |
| Frame Editor | each frame and slot, dirty, saving, saved, error, delete confirm, drag/resize result, crop fill/fit, validation, narrow layout |
| Recent Photos | loading, populated, empty, detail, uploaded, pending, failed/retryable, expired, local receipt, unavailable, refresh |
| Settings overview | healthy, degraded, camera summary, retention |
| Network | disabled/enabled, open Select where applicable, validation, certificate action, saving/saved/error |
| Displays | modes, both Select popups, swap, saving/saved |
| Google Photos | connected/disconnected, enabled/disabled, resolved/unresolved, counters, saving/error |
| Security & Cloud | validation, busy, password visibility, safe placeholder-only cloud form |
| Upload Queue | populated, empty, failed, retrying, disabled action |
| Camera | adapter choices, device/resolution Select popups, loading, ready, permission/error, mock, Sony unsupported, save feedback |

## Accessibility and regression plan

- Axe: zero serious or critical violations for every major page and overlay; manually review moderate findings.
- Keyboard: Tab/Shift+Tab, Enter/Space, Escape, arrow navigation, Tabs, RadioGroup, Select, focus traps/restoration, validation focus, disabled/busy controls, visibility toggles.
- Geometry: document and scroll-owner overflow, viewport bounds, intersections, zero-size controls, 44px targets, popup/dialog bounds, clipping, technical-value wrapping.
- Contrast: text, status, controls, and focus indicators against WCAG AA using only the locked palette and alpha variants.
- Regression: renderer component tests, package typecheck, kiosk typecheck/build, kiosk Playwright visual/electron suites, and public suite.
- Snapshots are updated only after independent after-captures are visually reviewed.

## Approval request

Approval authorizes the exact files and architecture above, including the minimal `App.tsx` operator-only fixture/provider integration. It does not authorize dependency changes, workflow changes, new colors, or any forbidden-path edit.

## Checkpoint integrity verdict

- `git diff --quiet HEAD` outside this timestamped artifact: PASS.
- Untracked files outside this timestamped artifact: none.
- All five forbidden group aggregates, `pnpm-lock.yaml`, and `wrangler.jsonc` match the baseline byte-for-byte.
- Product-source edits at this checkpoint: none.
- Detailed repeat values: `baseline/checkpoint-status.txt`.

**Implementation is paused here pending explicit approval.**

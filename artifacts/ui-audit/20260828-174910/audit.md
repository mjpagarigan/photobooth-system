# Grace Booth Frontend Redesign Audit

- Audit started: 2026-08-28 17:49:10 Asia/Manila
- Workspace: `C:\Users\padil\mj\photobooth-system`
- Review baseline: working tree versus `HEAD` (`092805d`)
- Specification: user-provided frontend audit brief
- Source-edit status: no source files edited when this artifact was created

## Evidence baseline

- `baseline/git-status.txt`: complete initial worktree status.
- `baseline/frontend.patch`: tracked frontend/config/snapshot patch plus every untracked `packages/ui` file.
- `baseline/forbidden.patch`: tracked forbidden-path patch.
- `baseline/forbidden-status.txt`: all existing forbidden-path changes, classified as **pre-existing/unknown provenance**.
- `baseline/forbidden-sha256.json`: SHA-256 manifest for 118 tracked/untracked forbidden files, including missing/deleted entries.
- `baseline/workspace-permissions.json`: workspace owner and effective access rules.

Forbidden surfaces are `apps/kiosk/src/main/**`, `apps/kiosk/src/preload/**`, `packages/shared/**`, `supabase/**`, `infra/**`, `wrangler.jsonc`, backend/deployment scripts, and unrelated documentation. They must remain byte-for-byte identical to this baseline.

## Current frontend architecture

- Kiosk renderer: React application rooted at `apps/kiosk/src/renderer/App.tsx`; guest state screens, manual overlays, operator shell, and deterministic development-only visual seeds.
- Public page: React application rooted at `apps/public/src/App.tsx`; fragment-token resolution and mocked HTTP routes in Playwright.
- Shared UI: untracked `packages/ui`, exporting 18 coss-inspired components and semantic theme tokens.
- Styling: Tailwind CSS v4 is enabled through Vite, but both applications retain large bespoke stylesheet layers.
- Existing visual coverage: 11 kiosk seeds at 1280x720 and 1366x768, plus limited review stress tests and three public functional scenarios.

### Actual `@grace-booth/ui` imports

| Consumer                     | Imports                        | Classification                                  |
| ---------------------------- | ------------------------------ | ----------------------------------------------- |
| Public `App.tsx`             | `Button`, `Skeleton`           | Actual direct adoption                          |
| Kiosk local `Button.tsx`     | shared `Button`, `ButtonProps` | Indirect adoption through compatibility wrapper |
| Kiosk/public stylesheets     | shared `theme.css`             | Theme-token adoption                            |
| Other application components | none found initially           | Bespoke implementations requiring audit         |

## State and screenshot matrix

Filename convention: `<surface>--<state>--<interaction>--<width>x<height>.png` under `screenshots/before` and, for corrected defects, `screenshots/after`.

### Kiosk guest

- Viewports for every applicable state: 1280x720 and 1366x768.
- Loading; Attract default/focus/disabled/busy/camera-message.
- Recent gallery populated/empty/tile-focus/detail/close-focus-return.
- Camera Setup webcam/device-popup/resolution-popup/loading/ready/permission-error/unavailable/Sony/mock/success/error.
- Passcode bootstrap/login/restart/validation/busy/nondismissible/show-password/hide-password.
- Countdown shot-1/shot-2/shot-3/preparing/ready/capturing; cancellation hint.
- Review first/second/focus/horizontal controls/1-frame/3-frame/20-frame; additionally 768x1024 and 1920x1080.
- Processing build/upload/backoff/pending/QR-transition/reduced-motion.
- Final keepsake+QR/Done-focus/Recent-action.
- Recovery camera/upload/interrupted and enabled/disabled retry/finish-offline controls.

### Operator

- Frame Editor, Recent Photos, and Settings & Health selected at 1280x720 and 1366x768.
- Frame Editor default/alternate/slot-1/slot-2/slot-3/coordinates/drag/crop/add/delete/save-busy/save-error/save-success; additionally 768x1024 and 1920x1080.
- Recent Photos grid/detail/failed-upload/unavailable-copy/retry/repair.
- Settings & Health top/middle/bottom, health variants, camera/network/cloud/security/recovery, validation, Select popups, Switch states, disabled/busy controls, alerts, and toasts.

### Public page

- Viewports for each state: 390x844, 768x1024, 1440x900.
- Loading; ready; download idle/busy/error; external CTA focus/hover; non-retryable error; retryable error; keyboard sequence; long localized expiry; reduced motion.

## coss compliance checklist

- [ ] Validate all Base UI imports and documented coss names.
- [ ] Verify styled exports, refs, controlled/uncontrolled state, portals, layering, and isolated roots.
- [ ] Dialog header/panel/footer, title/description, scrolling, Escape, and focus return.
- [ ] Dialog forms keep header outside `Form className="contents"` panel/footer wrapper.
- [ ] AlertDialog restricted to destructive/critical confirmations with ghost cancel and destructive confirm.
- [ ] Select uses items-first root, trigger/value/popup/items, keyboard support, and stable form serialization.
- [ ] Forms use Field/Label/Description/Error, explicit types, names, and aligned invalid semantics.
- [ ] Sidebar provider/content/menu/inset/responsive/active semantics.
- [ ] Tabs values match panels and represent actual panel switching.
- [ ] Toast uses Base UI/coss managers and providers.
- [ ] Icons inherit sizing where expected and expose correct semantics.
- [ ] Theme preserves semantic palette/font contracts and Tailwind v4 syntax.
- [ ] Identify dead primitives and remaining bespoke equivalents without counting exports as adoption.

## Accessibility, interaction, and geometry checklist

- [ ] Pointer plus Tab/Shift+Tab, Enter/Space, Escape, arrows, focus trap/return, validation focus, retry/repair, and password visibility.
- [ ] Normal and reduced motion.
- [ ] Axe on every major page and overlay; zero serious/critical violations.
- [ ] Manual WCAG AA contrast review for text, status, controls, disabled states, and focus indicators.
- [ ] `scrollWidth <= clientWidth` and intended kiosk fit-height.
- [ ] No critical-control intersections, off-screen or zero-sized visible controls, clipped text, or clipped portals.
- [ ] Guest targets at least 48x48; operator targets reasonably accessible.
- [ ] Dialog/popup bounds remain inside the viewport.
- [ ] QR is square, at least 180px, unobstructed, and sufficiently separated.
- [ ] Visual inspection at full screenshot resolution supplements all automated checks.

## Functional regression checklist

- [ ] Booth state-machine transitions and controls unchanged.
- [ ] Camera acquisition lifecycle and adapter behavior unchanged.
- [ ] IPC calls, payloads, and preload bridge types unchanged.
- [ ] Passcode/authentication rules unchanged.
- [ ] Upload/retry/repair/retention/QR-readiness behavior unchanged.
- [ ] Public API and token-leak protections unchanged.
- [ ] Backend/cloud/storage/database/deployment behavior unchanged.

## Initial risks and uncertainties

- **Confirmed repository fact:** the working tree contains substantial pre-existing forbidden changes, including a deleted infrastructure file and untracked Supabase repair code.
- **Confirmed repository fact:** the existing fixture suite does not expose most required overlays and transient states.
- **Suspected defect requiring browser verification:** shared primitive exports appear broader than actual adoption, so the claimed migration may be incomplete.
- **Suspected defect requiring browser verification:** kiosk dialogs, selects, navigation, forms, and feedback remain largely bespoke.
- **[uncertain]:** no earlier redesign contract exists in the repository; this audit brief is the sole specification.
- **Intentional design choice until disproved:** the cinematic/editorial visual direction and bespoke layout styling are not defects by themselves.
- **Pre-existing unrelated change:** every baseline entry outside the allowed frontend/test/artifact paths.

## Findings

| ID   | Severity | Surface/state                                              | Viewport           | Screenshot                                                                                                                   | Reproduction                                                                           | Expected                                                                                                                                                                       | Actual                                                                                                                                                                                                                                                                                                 | Likely source                                                                                                                                                          |
| ---- | -------- | ---------------------------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F-01 | P1       | Kiosk / Camera Setup / every adapter and acquisition state | 1280x720, 1366x768 | `screenshots/before/kiosk--camera-setup--permission-error--1280x720.png` (representative)                                    | Open Camera Setup from Attract.                                                        | A bounded, readable, keyboard-contained settings dialog with visible source cards, fields, preview, status, and actions.                                                       | Camera-specific classes have no stylesheet rules. The whole form collapses into unstyled inline content over the booth, labels and cards concatenate, preview geometry disappears, and the interaction is unusable.                                                                                    | `CameraSetupModal.tsx`; missing `.camera-*` rules in `apps/kiosk/src/renderer/styles.css`.                                                                             |
| F-02 | P1       | Operator / Frame Editor / portrait stress                  | 768x1024           | `screenshots/before/kiosk--admin-frame--portrait--768x1024.png`                                                              | Load `?visual=admin-frame` at 768x1024.                                                | All editor regions and primary actions remain reachable without horizontal clipping.                                                                                           | The fixed 260px sidebar plus fixed 280px library and 320px inspector exceed the remaining viewport. Save, stage, and inspector are clipped outside the non-scrollable shell.                                                                                                                           | Fixed widths and `overflow: hidden` in `.admin-shell`, `.frame-editor`, `.frame-editor__workspace`, `.frame-library`, and `.slot-inspector`; no responsive breakpoint. |
| F-03 | P1       | Kiosk / Recent Photos / detail                             | 1280x720           | `screenshots/before/kiosk--recent-gallery--detail--1280x720.png`                                                             | Focus a gallery tile, press Enter, then Tab/Shift+Tab/Escape.                          | Focus enters and remains within the nested detail dialog, Escape closes only the top dialog, the scroll region is keyboard accessible, and focus returns to the invoking tile. | Focus is not moved into the detail dialog and the trap is disabled while detail is open. The scrollable body has no keyboard access; axe reports `scrollable-region-focusable` (serious). The effect cleanup also restores focus on every detail state change rather than only outer-dialog dismissal. | `RecentGallery.tsx` effect dependencies and missing detail refs/tab stop.                                                                                              |
| F-04 | P2       | Guest kiosk / global utility and overlay controls          | 1280x720, 1366x768 | `screenshots/before/kiosk--attract--default--1280x720.png`, `screenshots/before/kiosk--recent-gallery--detail--1280x720.png` | Measure visible guest buttons.                                                         | Guest targets are at least 48x48 CSS px.                                                                                                                                       | Attract Recent/Camera/Admin controls are 34.5px tall; overlay close controls are 32x32. Equivalent utility buttons recur on processing/final/recovery.                                                                                                                                                 | `.operator-access`, `.icon-button`, and password/overlay control sizing.                                                                                               |
| F-05 | P2       | Public / loading                                           | 390x844, 768x1024  | `screenshots/before/public--loading--default--390x844.png`, `screenshots/before/public--loading--default--768x1024.png`      | Load the mocked pending-token state and run axe.                                       | The vertically scrollable loading document has a keyboard-reachable descendant.                                                                                                | The loading state has no focusable content; axe reports `scrollable-region-focusable` against `html` (serious) at both narrow viewports.                                                                                                                                                               | Loading branch in `apps/public/src/App.tsx`.                                                                                                                           |
| F-06 | P2       | Shared UI / coss conformance                               | Static inspection  | n/a                                                                                                                          | Compare `packages/ui` exports and behavior with current official coss/Base UI sources. | Exported primitives implement the documented semantics and composition APIs; adoption is counted only at app call sites.                                                       | `Form` is a native form with an undocumented default layout; `ButtonProps.render` is ignored; Toast is a custom global context with an empty anchored provider; Dialog/AlertDialog/Select/Sidebar omit documented structural behavior. Most primitives are unused by either app.                       | `packages/ui/src/components/{form,button,toast,dialog,alert-dialog,select,sidebar}.tsx`.                                                                               |

No product-source correction had been made when F-01 through F-06 were entered. Public loading's root-scroll finding was manually checked: the scroll itself is intentional, but the absence of any focusable loading-state descendant is actionable. No horizontal overflow was detected in the 88-capture corpus; off-viewport settings content is intentional page scrolling except for F-02.

## coss adoption table

| Intended primitive                     |                                                                           Shared implementation valid? |                              Actually used? | Remaining bespoke equivalent                        | Action                                                                                                                                     |
| -------------------------------------- | -----------------------------------------------------------------------------------------------------: | ------------------------------------------: | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Button / loading (`p-button-41`)       |               No: `render` is advertised but ignored; default size is below the 48px guest requirement | Yes: public directly; kiosk through wrapper | Native guest utility/icon controls                  | Correct composition contract; raise guest-only targets without changing operator density.                                                  |
| Skeleton                               |                                                                                  Yes for current usage |                                 Yes: public | Bespoke kiosk loading visuals                       | Retain.                                                                                                                                    |
| Dialog (`p-dialog-1`, `p-dialog-5`)    | Partial: Base UI root/trigger/portal are present, but documented viewport/scroll composition is absent |                                          No | Passcode, Camera Setup, Recent Gallery/detail       | Do not claim adoption; remediate confirmed bespoke-dialog failures locally. Migration remains `[uncertain]` without a historical contract. |
| AlertDialog (`p-alert-dialog-1`)       |                                                                 Partial for the same structural reason |                                          No | Inline frame deletion confirmation                  | Do not claim adoption; destructive-dialog migration is `[uncertain]`.                                                                      |
| Select (`p-select-1`, `p-select-23`)   |               Partial: popup omits the documented `Select.List`; label is not the documented primitive |                                          No | Native camera/settings selects                      | Do not claim adoption; preserve native semantics unless a validated migration requirement appears.                                         |
| Form / Field (`p-form-1`, `p-field-4`) |                                               No for Form; Field is structurally close to current docs |                                          No | Native passcode, camera, settings, and editor forms | Correct Form wrapper; bespoke forms remain intentional unless they fail accessibility.                                                     |
| Sidebar / Toolbar                      | No: custom reduced sidebar lacks current provider/mobile/inset behavior; Toolbar is structurally close |                                          No | Operator `AdminShell` navigation                    | Fix supported-width behavior locally; do not count shared export as migration.                                                             |
| Tabs (`p-tabs-1`)                      |                                                                   Structurally consistent with Base UI |                                          No | Frame slot tablist                                  | Keep bespoke tablist if keyboard verification passes; adoption is false.                                                                   |
| Toast (`p-toast-2`, `p-toast-3`)       |                                                No: custom global context; anchored provider is a no-op |                                          No | Inline status/feedback                              | Do not claim adoption; replacement is required before app use.                                                                             |

## Verification log

Commands and exact outcomes will be appended as the audit proceeds.

## Final report

Pending completion of rendered inspection, remediation, verification, and forbidden-baseline comparison.

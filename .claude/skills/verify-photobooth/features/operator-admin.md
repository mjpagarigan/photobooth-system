# Operator access and admin

An operator unlocks the admin area with the booth passcode, then manages frames in the frame editor, reviews recent photos, and checks settings and health before returning to guest mode. Access locks again on exit.

## Sub-features

- `admin-unlock` asks for the passcode and opens the admin shell.
- `admin-frames` shows the frame library and the slot editor.
- `admin-recent` shows the operator gallery.
- `admin-settings` shows settings categories and health.
- `admin-exit` returns to the attract screen.

## How to get to it (user POV)

- Tap `Admin` on the attract screen, enter the passcode, tap `Unlock`.
- Use the sidebar: `Frame editor`, `Recent photos`, `Settings & health`, `Back to booth`.

## Driving it with verify-photobooth

Preconditions:

- Doctor is `READY`. The journey's bootstrap set the passcode `grace-verify-2026`.

- **Run.** `pnpm exec playwright test -c .claude/skills/verify-photobooth/playwright.config.ts --project=kiosk kiosk-operator`.
- **Passcode.** Tap `Admin`; a dialog shows. Evidence `operator/03-passcode`. Fill `#operator-passcode`, tap `Unlock`; `admin-shell` shows.
- **Frames.** Tap `Frame editor`; `frame-editor` shows. Evidence `04-frame-editor`.
- **Recent.** Tap `Recent photos`. Evidence `05-admin-recent-photos`.
- **Settings.** Tap `Settings & health`; `admin-settings` shows. Evidence `06-settings-health`.
- **Exit.** Tap `Back to booth`; `attract-screen` shows. Evidence `07-back-to-booth`.

## Gotchas

- Unlocking can take over 15 seconds while the Vite servers compete for CPU. The dialog's `Close` button is disabled while the passcode is checked; wait for `admin-shell` rather than retrying.
- Sidebar `Recent photos` (lower-case p) and attract `Recent Photos` are different buttons.
- Health in E2E mode reports the E2E delivery client, not the real Supabase project. Cloud health against production is unverified here.
- Editing frames, importing a PNG, and changing settings are not driven yet. Add steps before claiming those sub-features.

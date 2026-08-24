# Ticket — ESC cancel during and after capture

Label: wayfinder:task (fixes 3+4)
Status: open

## Question

What is the cancel interaction and its cleanup contract for aborting an in-flight session?

## Decision

Single ESC press arms cancellation with an on-screen hint ("Press ESC again to cancel"); second ESC within 2 seconds aborts. Valid in every live guest state: countdown before shot 1, between shots, immediately after any shutter, and ReviewScreen pre-accept. Abort = new `booth:cancel-session` bridge command → workflow marks session cancelled, deletes partial vault files + DB asset rows, releases camera stream, returns to AttractScreen. Must not break existing ESC handlers in PasscodeDialog / CameraSetupModal.

## Key facts from recon

- No guest-facing cancel exists; ESC handled only by modals (`PasscodeDialog.tsx:48-49`, `CameraSetupModal.tsx:77-82`).
- Global key handler pattern exists at `App.tsx:421-430` (Ctrl/Cmd+Shift+A).
- Cleanup paths available: PhotoVault deletion + drizzle asset rows; `restartSession` shows the reconnect/recovery seam.

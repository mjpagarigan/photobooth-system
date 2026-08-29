# Ticket — Camera lifecycle: fresh acquisition per capture window + per-shot timers

Label: wayfinder:task (fixes 1, 5, 6)
Status: closed

## Question

How does the kiosk acquire, refresh, and release the webcam so that (a) a restarted webcam is picked up without re-running Camera Setup, and (b) the camera is only powered during active picture-taking?

## Resolution

- **App vs Modal Stream Isolation**: Prevented camera device locking in Windows/DirectShow by ensuring `liveCameraEnabled` in `App.tsx` is disarmed whenever `cameraSetupOpen` is active (`!cameraSetupOpen`).
- **Normalized Device Selection**: Handled whitespace and nullish device strings in `useCameraStream.ts` without dropping selected hardware constraints.
- **Dynamic Device Label Refreshing**: `CameraSetupModal.tsx` now listens to `cameraStream.ready` to re-enumerate media devices once access is granted, updating device labels from raw hashes to human-readable strings, and explicitly formats `SelectValue` labels.
- **Robust Video Element Playback**: Safely calls `element.play()` upon stream assignment with environment capability checks.

## Key facts from recon

- `apps/kiosk/src/renderer/hooks/useCameraStream.ts`: single `getUserMedia`, no retry/reconnect; `denied` on failure; devices enumerated only when called.
- Persistent stream today = battery drain + stale device handles after physical restart.
- Countdown: global `countdownMs` (5000ms prod / 40ms e2e) in `apps/kiosk/src/main/config.ts:84`, applied in `booth-workflow.beginCountdown` (`booth-workflow.ts:273-283`); renderer clamp in `App.tsx:70-90` caps at 5s.
- Adapter layer (`dynamic-camera-adapter`, sony, mock) must stay untouched.

# Ticket — Camera lifecycle: fresh acquisition per capture window + per-shot timers

Label: wayfinder:task (fixes 1, 5, 6)
Status: open

## Question

How does the kiosk acquire, refresh, and release the webcam so that (a) a restarted webcam is picked up without re-running Camera Setup, and (b) the camera is only powered during active picture-taking?

## Resolution

(to be recorded after execution)

## Key facts from recon

- `apps/kiosk/src/renderer/hooks/useCameraStream.ts`: single `getUserMedia`, no retry/reconnect; `denied` on failure; devices enumerated only when called.
- Persistent stream today = battery drain + stale device handles after physical restart.
- Countdown: global `countdownMs` (5000ms prod / 40ms e2e) in `apps/kiosk/src/main/config.ts:84`, applied in `booth-workflow.beginCountdown` (`booth-workflow.ts:273-283`); renderer clamp in `App.tsx:70-90` caps at 5s.
- Adapter layer (`dynamic-camera-adapter`, sony, mock) must stay untouched.

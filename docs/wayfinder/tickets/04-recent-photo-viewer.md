# Ticket — Recent photo viewer with metadata (three surfaces)

Label: wayfinder:task (fix 7)
Status: open

## Question

Where does recent-gallery data come from and how do the three surfaces render it?

## Decision

New main-process gallery RPC (`gallery:get-recent(limit)`) over existing session/asset DB + vault listing (pattern: `listSessionsWithPublicSecret(100)` in `offline-delivery-server.ts`). Each item: decrypted photostrip preview (image worker), per-item QR via `qr-service`, metadata (captured date/time, shot/frame info, upload status, cloud expiry). Surfaces:

1. FinalQrScreen — "Recent" button beside QR panel.
2. AttractScreen — "Recent" entry point.
3. Operator panel — same viewer plus full metadata detail.

Guest surfaces show strip + scannable QR; operator view adds metadata columns.

## Key facts from recon

- QR service: `apps/kiosk/src/main/cloud/qr-service.ts` builds `${publicPageOrigin}/photo#${publicToken}`.
- Offline tokens exist even without cloud (`upload-queue.ts:153`).

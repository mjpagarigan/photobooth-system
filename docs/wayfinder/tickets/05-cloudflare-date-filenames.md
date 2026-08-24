# Ticket — Cloudflare/R2 date-based object names

Label: wayfinder:task (fix 8)
Status: open

## Decision

Replace UUID naming in `allocateStoragePath` (`supabase/functions/create-upload/index.ts:59-63`) with `MM-DD-YYYY/MM-DD-YYYY-HH-MM-SS.jpg` (folder per day, human-readable file name). Kiosk supplies capture timestamp (validated ISO) in the create-upload payload; function formats from it, falls back to current UTC time. Collision policy: head-check key; append `-2`, `-3`, … on conflict. Keys remain stored in DB rows so confirm/cleanup/delete logic stays transparent.

## Key facts from recon

- R2 access via AWS S3 API wrapper `supabase/functions/_shared/r2.ts` (presigned PUT, head, get, batch delete).
- Fallback storage path (Supabase Storage bucket) should follow the same naming.
- Download filename in `apps/public/App.tsx` intentionally unchanged (out of scope).

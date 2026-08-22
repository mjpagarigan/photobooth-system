# Grace Booth Supabase delivery service

This directory contains the complete private-photo delivery boundary. It does not provision or
deploy a hosted project by itself.

## Runtime contract

- `create-upload` and `confirm-upload` require a dedicated Supabase Auth user JWT. Both functions
  also verify that the user is enabled in `public.booth_devices`.
- The kiosk receives an unpredictable 32-byte base64url token derived with domain-separated
  HMAC-SHA-256. Postgres stores only `SHA-256(token)`; the HMAC key is a server-only Function
  secret.
- A create retry for the same booth and `clientSessionId` is atomic. A matching pending row or
  never-ready cleanup tombstone returns the same session, Storage path, and token even when requests
  overlap or arrive out of order. The stored hash is never rotated by an idempotent replay.
- The private `photos` bucket accepts JPEG uploads through a two-hour signed upload token. Callers
  cannot choose a final object path and cannot read the bucket directly.
- `photo/resolve`, `photo/image`, and `photo/download` accept POST with exactly `{ "token": "..." }`.
  They require the configured browser origin, reveal no internal path, and treat missing and expired
  tokens identically. Image bytes are served through a fresh exact-expiry check rather than a
  signed download URL.
- Cleanup atomically moves expired or abandoned rows into a terminal `deleting` state before any
  Storage call, removes each private object, then records deletion. A claimed session can never race
  back to `ready`. Failed items retain their lease until timeout so later batches are not starved.
  Public resolution checks `expires_at` independently, so access stops exactly 720 hours after
  confirmation even if the daily cleanup has not run.
- A cleaned tombstone that was never ready can be reopened only by its owning booth, with the same
  client-session id, expected image metadata, token hash, session id, and opaque path. This lets a
  retained local collage resume after the 24-hour inactive-pending cleanup window. Resuming a
  pending session atomically refreshes its activity timestamp before cleanup can claim it. Reopening
  a cleaned session advances an internal delivery generation, so an older in-flight confirmation
  cannot mark the replacement upload ready. A tombstone that was once ready can never be reopened
  or have its public expiry extended.

## Function environment

Supabase supplies `SUPABASE_URL` automatically. Hosted Functions use the default key from the
platform-provided `SUPABASE_SECRET_KEYS` JSON object. The code also accepts `SUPABASE_SECRET_KEY` for
local development and `SUPABASE_SERVICE_ROLE_KEY` only as a legacy fallback.

Configure these server-only values:

```text
PUBLIC_PAGE_ORIGIN=https://<exact-production-photo-origin>
PHOTO_BUCKET=photos
CLEANUP_SECRET=<at-least-32-random-characters>
PUBLIC_TOKEN_DERIVATION_KEY=<at-least-32-random-bytes-as-base64-or-hex>
```

`PUBLIC_PAGE_ORIGIN` must be an origin only, with no path. It must exactly match both the Vercel
production origin and the browser `Origin` header. Never place any server key, cleanup secret, or
token-derivation key in Electron, Vercel, browser code, SQLite, or logs.

`PUBLIC_TOKEN_DERIVATION_KEY` accepts standard base64, base64url, or hexadecimal encoding and must
decode to at least 32 random bytes. Keep it backed up as a production secret. Do not rotate it while
any pending upload can still be replayed: stop new creates, allow or clear the 24-hour pending
window, then rotate. Rotation does not invalidate already-confirmed public links because those are
resolved from their stored SHA-256 hashes, but it prevents deterministic recovery of a pending
create made under the previous key unless the kiosk already sealed that token and uses the resume
action.

Generate a 32-byte base64 value in PowerShell without reusing a passphrase:

```powershell
$keyBytes = [byte[]]::new(32)
[Security.Cryptography.RandomNumberGenerator]::Fill($keyBytes)
[Convert]::ToBase64String($keyBytes)
```

For local Function serving, put the same names in the ignored `supabase/.env.local` file and use the
local URL and local server key printed by Supabase CLI. A localhost `PUBLIC_PAGE_ORIGIN` may use
HTTP; non-local origins require HTTPS.

## Hosted project setup after approval

Apply these only after the project, region, production domain, and deployment have been approved:

- The production Supabase project region is locked to **Singapore**. Do not create a project in any
  other region, and do not provision the Singapore project until deployment is separately approved.

1. Push the checked-in migrations.
2. Materialize the bucket configuration with `supabase seed buckets --linked`. Bucket metadata is
   owned by the Storage service and is intentionally not inserted by SQL.
3. Create a dedicated Auth user for each booth, then enroll its Auth UUID:

   ```sql
   insert into public.booth_devices (user_id, device_name)
   values ('<dedicated-auth-user-uuid>', 'Main booth');
   ```

4. Set the Function environment values above.
5. Put the project URL and the same cleanup secret into Vault. The migration's scheduled function
   reads only these two named secrets:

   ```sql
   select vault.create_secret(
     'https://<project-ref>.supabase.co',
     'grace_booth_project_url'
   );

   select vault.create_secret(
     '<same-value-as-CLEANUP_SECRET>',
     'grace_booth_cleanup_secret'
   );
   ```

The checked-in Cron job runs daily at `17 19 * * *` UTC and invokes only
`/functions/v1/cleanup-expired`. The raw cleanup secret is not embedded in the job command or any
migration.

## Local verification

Docker Desktop or Podman is required for the database and Storage integration checks:

```powershell
pnpm supabase:start
pnpm db:reset
pnpm exec supabase test db supabase/tests/database --local --workdir supabase
```

Edge code can be checked without containers:

```powershell
pnpm functions:check
pnpm functions:lint
pnpm functions:format:check
pnpm test:functions
```

The pgTAP suite verifies the schema, forced RLS, denied direct access, private bucket, absolute
720-hour expiry, stable idempotent creates, generation-bound atomic confirmation, activity-based
pending recovery, cleanup tombstones and leases, and Cron registration.

The checked-in live suite is deliberately gated and refuses any non-loopback Supabase URL. With the
local stack and Functions running, export the local publishable and secret keys printed by
`supabase status`, use the same cleanup secret as `supabase/.env.local`, then run:

```powershell
$env:GRACE_BOOTH_RUN_SUPABASE_INTEGRATION = '1'
$env:SUPABASE_URL = 'http://127.0.0.1:54321'
$env:SUPABASE_PUBLISHABLE_KEY = '<local-publishable-key>'
$env:SUPABASE_SECRET_KEY = '<local-secret-key>'
$env:CLEANUP_SECRET = '<same-local-cleanup-secret>'
$env:PUBLIC_PAGE_ORIGIN = 'http://127.0.0.1:4173'
pnpm test:supabase:integration
```

It covers booth allow-listing and ownership, direct-access denial, concurrent create idempotency,
signed uploads, malformed content, atomic confirmation, exact expiry, CORS and route restrictions,
controlled image/download responses, expired-token equivalence, and repeated cleanup. The test
creates only randomized local identities and refuses hosted targets.

## UPDATED how to deploy backend (Supabase + Cloudflare R2)

## Part A — Supabase (database + auth)

1. **Create the project** at supabase.com — the repo's docs lock production to the **Singapore** region; pick that unless you have a reason not to.
2. **Link and push migrations:**
   ```powershell
   pnpm exec supabase link --project-ref <project-ref> --workdir supabase
   pnpm exec supabase db push --workdir supabase
   ```
3. **Create a dedicated Auth user per physical booth** (not a human admin account), then enroll it:
   ```sql
   insert into public.booth_devices (user_id, device_name)
   values ('<booth-auth-user-uuid>', 'Main booth');
   ```
4. You can skip `supabase seed buckets --linked` — that materializes the Supabase Storage `photos` bucket, which becomes dead weight once R2 is configured (the code never touches it in R2 mode). Harmless either way, just unnecessary.

## Part B — Cloudflare R2 (photo storage)

1. In the Cloudflare dashboard → R2 → **Create bucket** (e.g. `grace-booth-photos`). Keep it private — nothing here needs public bucket access, since photos are always served through the Supabase Edge Function proxy, never a direct R2 URL.
2. **R2 → Manage API tokens → Create API token**, scoped to that bucket, with Object Read & Write. Save the **Access Key ID** and **Secret Access Key** — shown once.
3. Note your **Cloudflare Account ID** (right sidebar of the R2 dashboard).

## Part C — Wire R2 into the Supabase Edge Functions

These are server-only secrets, set on the Supabase project (never in the kiosk or public app):

```text
R2_ACCOUNT_ID=<your-cloudflare-account-id>
R2_ACCESS_KEY_ID=<from-the-api-token>
R2_SECRET_ACCESS_KEY=<from-the-api-token>
R2_BUCKET_NAME=grace-booth-photos
```

Plus the existing required secrets from `SETUP.md` §9:
```text
PUBLIC_TOKEN_DERIVATION_KEY=<32+ random bytes, base64 or hex>
PUBLIC_PAGE_ORIGIN=https://photos.example.org
PHOTO_BUCKET=photos
CLEANUP_SECRET=<32+ random characters>
```

**Hosted project:**
```powershell
pnpm exec supabase secrets set --workdir supabase `
  R2_ACCOUNT_ID=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... R2_BUCKET_NAME=grace-booth-photos `
  PUBLIC_TOKEN_DERIVATION_KEY=... PUBLIC_PAGE_ORIGIN=https://photos.example.org PHOTO_BUCKET=photos CLEANUP_SECRET=...
pnpm exec supabase functions deploy --workdir supabase
```

**Local dev** — put the same names in the gitignored `supabase/.env.local`, then `pnpm functions:serve`.

Also still create the two Vault secrets the cron cleanup job reads (unchanged by the R2 switch):
```sql
select vault.create_secret('https://<project-ref>.supabase.co', 'grace_booth_project_url');
select vault.create_secret('<same-value-as-CLEANUP_SECRET>', 'grace_booth_cleanup_secret');
```

## Verify

```powershell
pnpm functions:check
pnpm functions:lint
pnpm test:functions
```
Then run a full mock session end-to-end (`SETUP.md` §6) and confirm in the Cloudflare R2 bucket that an object lands under `<year>/<month>/<sessionId>.jpg` after "Use these photos."

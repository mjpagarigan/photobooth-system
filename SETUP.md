# Grace Booth setup and operations

This guide prepares the Grace Booth MVP for local development and an approved future deployment. The repository does not create hosted resources, deploy Functions, configure DNS, change firewalls, or install camera SDKs.

## 1. Supported workstation

Use a Windows x64 workstation with:

- Windows 11, or Windows 10 covered by an active ESU agreement for production.
- Node.js 24.x.
- pnpm 11.x through Corepack.
- At least 4 GB of free disk space for dependencies, test browsers, and package output.
- Docker Desktop or a compatible container runtime only when running the local Supabase database suite.

The current development host can build the app but runs Windows 10 build 19045, which is past standard support. Do not use it as an unattended production booth without Windows 10 ESU.

Verify the toolchain:

```powershell
node --version
pnpm --version
```

The expected major versions are Node 24 and pnpm 11.

## 2. Install the workspace

From the repository root:

```powershell
corepack enable
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
```

The checked-in pnpm lockfile and `allowBuilds` policy control dependency installation. Sharp and better-sqlite3 use their compatible Windows x64 prebuilds. A local Python or Visual Studio C++ toolchain is not required for this pinned dependency graph.

Do not run a broad native rebuild. The kiosk packages the pinned N-API binaries and validates them with its native self-test.

## 3. Local configuration

Use `.env.example` as a name and value reference. The Electron main process intentionally reads only its inherited OS or service environment; it does not parse a project `.env` file. Set kiosk values in the launching PowerShell session or in the approved Windows service wrapper, never in renderer build variables.

The kiosk defaults to `WebcamCameraAdapter`, which uses the laptop or system camera. Set `GRACE_BOOTH_CAMERA_ADAPTER=mock` to run the deterministic fixture flow instead; `sony` stays gated (see section 13). The local flow needs no cloud key or hosted account. Cloud settings require both values or neither:

```text
GRACE_BOOTH_CAMERA_ADAPTER=webcam
GRACE_BOOTH_SUPABASE_URL=https://<project-ref>.supabase.co
GRACE_BOOTH_SUPABASE_PUBLISHABLE_KEY=sb_publishable_REPLACE_ME
```

On the webcam adapter, the kiosk window asks Windows for camera access the first time the guest screen loads. Grant it for the Grace Booth app; if it is denied or no camera is present, capture fails into the ordinary camera recovery screen rather than hanging. Microphone access is never requested and is refused if a page asks for it.

For a development session, for example:

```powershell
$env:GRACE_BOOTH_CAMERA_ADAPTER = 'mock'
$env:GRACE_BOOTH_SUPABASE_URL = 'https://<project-ref>.supabase.co'
$env:GRACE_BOOTH_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_REPLACE_ME'
pnpm dev:kiosk
```

Only the Supabase project URL and publishable key belong in the kiosk configuration. Enter the dedicated booth user's email and password through the authenticated Admin settings flow. Those credentials exist transiently in the local form and typed IPC request, are never persisted or logged, and the password field is cleared immediately after submission. The resulting Auth session stays in Electron main, sealed with `safeStorage`, and never enters SQLite.

Do not set the development-only `GRACE_BOOTH_E2E_*` variables for ordinary operation. The main process refuses test mode in packaged builds.

The public page has separate, renderer-safe Vite build values. Vite may read these from the launching shell or an ignored root `.env` file:

```text
VITE_PUBLIC_PHOTO_API_URL=https://<project-ref>.supabase.co/functions/v1/photo
VITE_PUBLIC_PAGE_ORIGIN=https://photos.example.org
VITE_PUBLIC_R2_ORIGIN=https://<bucket>.<account-id>.r2.cloudflarestorage.com
```

`VITE_PUBLIC_PAGE_ORIGIN` and the Function secret `PUBLIC_PAGE_ORIGIN` must be the same exact origin. Do not include a path or trailing slash.

When these public values are absent, `pnpm build` deliberately emits an inert `.invalid` page so local workspace verification remains deterministic and no accidental endpoint is contacted. Never deploy that inert output; an approved release must supply all three values so the build can generate the exact Cloudflare Pages CSP in section 10.

## 4. Run locally

Start the kiosk in development mode:

```powershell
pnpm dev:kiosk
```

Start only the public page:

```powershell
pnpm dev:public
```

The public page expects `/photo#<32-byte-base64url-token>`. Its browser tests provide a controlled local Function stub; an ordinary local page cannot resolve a hosted photo until the matching Supabase project and exact origin are configured.

## 5. First-run operator bootstrap

There is no default passcode and `7777` is deliberately rejected.

1. Launch the kiosk under the dedicated Windows booth account.
2. Complete the non-dismissible first-run prompt by creating an operator passcode between 8 and 64 characters.
3. Confirm that guest controls appear only after the passcode is saved and the temporary bootstrap authorization has been cleared.
4. Store it in the organization's approved password manager.
5. Open Admin Settings and connect the dedicated booth cloud identity only if an approved Supabase project exists.
6. Return to the booth. Leaving Admin re-locks operator controls and restores the guest state that was underneath it.

Passcode verification uses serialized scrypt with a fresh 32-byte salt, a 64-byte result, `N=131072`, `r=8`, and `p=1`. Failed attempts are rate-limited. Changing the passcode revokes all current admin sessions.

The booth stores runtime data under Electron's per-user application-data directory. Do not move or copy individual encrypted asset files. Recovery depends on the database, sealed installation key, secret store, and encrypted asset tree remaining together under the same Windows user profile.

## 6. Mock camera acceptance flow

The packaged mock camera is the only supported MVP adapter. Its preview is explicitly illustrative and its captures come from four packaged deterministic JPEG fixtures.

Verify the guest flow:

1. Start a session.
2. Complete four real eight-second countdowns.
3. Review all four captures.
4. Use **Retake all photos** at least once and complete a replacement round.
5. Use the replacement photos.
6. Observe local processing and the upload milestones.
7. If no cloud project is configured, verify the calm upload recovery screen and that it says the photo remains saved on the booth.
8. With an approved test project configured, verify that the QR appears only after upload confirmation succeeds.
9. Leave the Final screen open for more than ten minutes; it must remain available.
10. Select **Done** and confirm focus returns to **Start Session**.

Retake-all preserves prior rounds. Upload failure never discards the local collage. Restart recovery reconciles persisted sessions and resumes valid review, processing, upload, or final work.

## 7. Frame editor and settings

Open Admin with the operator passcode.

The Frame Editor accepts only a decoded PNG that:

- Is no larger than 5 MiB.
- Has real transparency.
- Matches the supported 4:5 portrait collage aspect (the shipped default frame is 3375 x 4219).
- Decodes within the image safety limits.

Regenerate the shipped default frame from source artwork with `pnpm --filter @grace-booth/kiosk frame:build <source.png>`, then confirm the photo cutouts with `pnpm --filter @grace-booth/kiosk frame:verify`. A booth that already auto-imported an older default picks up a replacement default on its next start; operator-imported frames are never overwritten.

Exactly four normalized slots are retained. Dragging and resizing have keyboard-equivalent X, Y, width, and height fields expressed as percentages. Each slot supports center-fill or fit. Save operations are revision-checked and atomic.

Admin Settings provides:

- An optional HTTPS Google Forms URL. Registration remains external and optional and never gates a download.
- Fixed 30-day cloud and 60-day local retention status.
- Upload queue inspection and manual retry.
- Passcode change.
- Camera and cloud health.
- LAN administration configuration, disabled by default.

## 8. Local administration and optional LAN HTTPS

Fastify binds to loopback only by default. Keep this default unless remote administration is explicitly approved.

LAN access requires all of the following:

1. Select one concrete RFC1918 private interface in Admin Settings.
2. Supply a trusted HTTPS PFX and its passphrase.
3. Confirm the certificate identity matches the private hostname or IP used by operators.
4. Create a narrowly scoped Windows Firewall rule for that executable, port, interface, and Private network profile.
5. Test from the trusted private network.

Grace Booth never binds LAN administration to `0.0.0.0`, never accepts a public interface, and never falls back to plaintext LAN HTTP. If the selected interface or certificate becomes invalid, loopback administration remains available and LAN access stops.

The application does not create or remove firewall rules automatically.

## 9. Prepare Supabase after deployment approval

Do not run this section until the project, Singapore production region, production origin, and deployment are approved. Singapore is the locked production Supabase region; selecting another region requires a new architecture decision.

The checked-in Supabase project contains:

- Forced-RLS `booth_devices` and `photo_sessions` tables.
- Hash-only public tokens and opaque private object paths.
- A private legacy `photos` bucket restricted to JPEG; new production objects use private R2.
- Authenticated `create-upload` and `confirm-upload` Functions.
- Public POST-only `/photo/resolve`, `/photo/image`, and `/photo/download` routes.
- Secret-authenticated, leased, idempotent cleanup.
- A daily Cron/`pg_net` call whose credentials come from Vault.

For a local container-backed project:

```powershell
pnpm supabase:start
pnpm db:reset
pnpm exec supabase test db supabase/tests/database --local --workdir supabase
```

For an approved linked project, apply the checked-in migrations and materialize the configured bucket:

```powershell
pnpm exec supabase db push --workdir supabase
pnpm exec supabase seed buckets --linked --workdir supabase
```

Create a dedicated Supabase Auth user for each physical booth. Do not reuse a human administrator account. Enroll its Auth UUID explicitly:

```sql
insert into public.booth_devices (user_id, device_name)
values ('<dedicated-auth-user-uuid>', 'Main booth');
```

Configure these server-only Function values:

```text
PUBLIC_TOKEN_DERIVATION_KEY=<at-least-32-random-bytes-as-base64-or-hex>
PUBLIC_PAGE_ORIGIN=https://photos.example.org
PHOTO_BUCKET=photos
CLEANUP_SECRET=<at-least-32-random-characters>
```

`PUBLIC_TOKEN_DERIVATION_KEY` is a server-only key for stable, domain-separated HMAC-SHA256 tokens. Generate it independently of every other secret. Do not rotate it while pending cloud sessions or unreconciled booth queues exist; a required incident rotation must be coordinated with those pending uploads. Ready links continue to validate against their stored token hashes.

Hosted Supabase supplies `SUPABASE_URL` and the server key set. For local Function serving, place an explicit `SUPABASE_SECRET_KEY` in the ignored `supabase/.env.local` file. Never place the derivation key, server key, cleanup secret, or service-role credential in Electron or the public app.

Create the two Vault entries read by the scheduled cleanup call:

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

Then deploy the Functions through the approved release workflow. Do not change `verify_jwt` or expose direct table or Storage policies to anonymous or authenticated clients.

The Functions additionally read the private R2 settings `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and `R2_BUCKET_NAME`; all four or none must be set. The private bucket must also carry the exact browser CORS policy documented in [docs/SECURITY_AND_RETENTION.md](./docs/SECURITY_AND_RETENTION.md) - without it the guest browser cannot follow the `303 See Other` to the presigned URL. Apply the checked-in policy after deployment approval:

```powershell
$env:R2_BUCKET_NAME = '<private-photo-bucket>'
$env:PUBLIC_PAGE_ORIGIN = 'https://photos.example.org'
$env:CLOUDFLARE_ACCOUNT_ID = '<cloudflare-account-id>'
$env:CLOUDFLARE_API_TOKEN = '<token-permitted-to-edit-r2-cors>'
pnpm r2:cors:apply
```

`pnpm r2:cors:apply` substitutes the exact production photo origin from `PUBLIC_PAGE_ORIGIN` into `infra/r2-cors.json` and applies it through `npx wrangler r2 bucket cors apply`. Origins are never hardcoded in the repository. Re-run the command if the approved origin or bucket ever changes, then confirm the full chain with `pnpm smoke:photo` against a valid token.

## 10. Prepare the Cloudflare Pages public page after deployment approval

Create or select the Cloudflare Pages project and configure it to build from the repository root:

```text
Build command: pnpm build
Build output directory: apps/public/dist
VITE_PUBLIC_PHOTO_API_URL=https://<project-ref>.supabase.co/functions/v1/photo
VITE_PUBLIC_PAGE_ORIGIN=https://photos.example.org
VITE_PUBLIC_R2_ORIGIN=https://<bucket>.<account-id>.r2.cloudflarestorage.com
```

The production Vite build validates all three origins and emits Cloudflare Pages `_headers` and
`_redirects` files into `dist`. Review the generated files before deploying through the approved
Cloudflare workflow:

```powershell
$env:VITE_PUBLIC_PHOTO_API_URL = 'https://<project-ref>.supabase.co/functions/v1/photo'
$env:VITE_PUBLIC_PAGE_ORIGIN = 'https://photos.example.org'
$env:VITE_PUBLIC_R2_ORIGIN = 'https://<bucket>.<account-id>.r2.cloudflarestorage.com'
pnpm --filter @grace-booth/public build
```

Do not deploy a build containing `.invalid` origins or unresolved placeholders.

Use a single approved production photo origin. Supabase CORS rejects preview origins by design. The guest QR is:

```text
https://photos.example.org/photo#<raw-token>
```

The fragment is not sent in HTTP request paths. The public page sends the token only in strict POST bodies and uses controlled, non-cacheable image and download responses.

## 11. Verification

Run the complete checks available on the workstation:

```powershell
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm native:self-test
```

The visual suite covers eleven deterministic states at both 1366 x 768 and 1280 x 720, including accessibility, overflow, bundled-font readiness, reduced motion, and third-party-request checks. Screenshot baseline updates are intentional review actions, never an automatic CI step.

The image suite validates signatures, decode limits, orientation, fill/fit behavior, deterministic center-crop fallback, frame-last composition, corrupt input handling, encrypted persistence, and decoded-pixel tolerances.

If Docker is available, also run the pgTAP command in section 9. If a hosted test project and physical Sony camera are unavailable, record those checks as blocked rather than substituting simulated results.

## 12. Build and inspect the Windows installer

Build the application, validate native modules under Electron, and create the unsigned x64 NSIS installer:

```powershell
pnpm build
pnpm native:self-test
pnpm dist:win
```

`pnpm dist:win` uses the checked-in hardened builder configuration, writes output beneath `apps/kiosk/release`, and then launches `win-unpacked/Grace Booth.exe --native-self-test`. Packaging fails unless packaged better-sqlite3, Sharp, the image worker, and `safeStorage` all pass. The standalone repeat command is:

```powershell
pnpm native:self-test:packaged
```

The installer is unsigned and intended for internal verification only.

On a clean Windows 11 test account:

1. Install Grace Booth.
2. Confirm first-run passcode bootstrap.
3. Run a complete mock session and retake round.
4. Restart during partial capture, processing, each upload phase, and Final.
5. Confirm Sharp, better-sqlite3, migrations, encrypted media, local protocols, and the image worker all function from the packaged ASAR layout.
6. Uninstall and confirm the installer removes application binaries. Treat retained application data according to the organization's media-retention policy.

Production release still requires an Authenticode certificate and signing workflow decision.

## 13. Real Sony camera gate

Do not set `GRACE_BOOTH_CAMERA_ADAPTER=sony` for guest operation. The adapter honestly reports `unsupported_pending_model_verification` until the exact camera body, firmware, official SDK, redistribution terms, byte-transfer behavior, USB acceptance suite, and twenty-capture soak test are approved.

Follow [docs/SONY_CAMERA_INTEGRATION.md](./docs/SONY_CAMERA_INTEGRATION.md). Do not add a hidden renderer, Python, an unofficial native bridge, or unapproved SDK binaries as a workaround. The supported `webcam` adapter is a separate laptop-camera product path; running on it does not satisfy or relax any part of the Sony gate.

## 14. Retention and incident response

Cloud access stops at the exact confirmation time plus 720 hours, even if cleanup has not run. Local guest assets expire after 60 days. Retention values are fixed and are not operator-editable.

If a booth credential, token, guest asset, or encryption key may be exposed:

1. Stop new sessions without deleting local data.
2. Disable the affected row in `booth_devices`.
3. Revoke its Supabase Auth sessions and rotate the device credential.
4. Expire affected photo rows and invoke idempotent cleanup.
5. Preserve only sanitized logs and audit records.
6. Determine whether local encrypted media or public bearer links were exposed.
7. Restore service only after the device, credentials, and deployment configuration are verified.

Never paste raw tokens, credentials, filesystem paths, image bytes, cookies, or signed upload capabilities into support tickets or shared logs. See [docs/SECURITY_AND_RETENTION.md](./docs/SECURITY_AND_RETENTION.md) for the full operating boundary.

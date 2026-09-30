# M.A.T. PHOTOBOOTH

M.A.T. Photobooth is an offline-first Windows kiosk for ministry and event photography. The active frame determines how many photos a session captures (1–10): the first shot uses an eight-second countdown and every later shot uses five seconds. Guests can review or retake the complete set, choose among compatible frame layouts, create the finished collage locally, and receive either a cloud or same-network QR download.

The Electron renderer is sandboxed and context-isolated. Local photos and frame artwork are encrypted at rest, durable workflow state is stored in SQLite, image processing runs through Sharp in a worker, and cloud delivery uses authenticated Supabase Edge Functions with private Cloudflare R2 or Supabase Storage.

This README is the canonical setup, deployment, packaging, and operations guide.

## Contents

- [Repository layout](#repository-layout)
- [Architecture](#architecture)
- [Implemented features](#implemented-features)
- [Requirements](#requirements)
- [Developer setup](#developer-setup)
- [Configuration reference](#configuration-reference)
- [Run locally](#run-locally)
- [First kiosk configuration](#first-kiosk-configuration)
- [Guest and operator workflows](#guest-and-operator-workflows)
- [Complete backend setup from scratch](#complete-backend-setup-from-scratch)
- [Optional Google Photos live album sync](#optional-google-photos-live-album-sync)
- [Build and install the Windows kiosk](#build-and-install-the-windows-kiosk)
- [Verification](#verification)
- [Troubleshooting](#troubleshooting)
- [Security, retention, and incident response](#security-retention-and-incident-response)
- [Related documentation](#related-documentation)

## Repository layout

- `apps/kiosk` — Electron 43 and React 19 kiosk, local storage, capture workflow, frame editor, QR delivery, and Windows packaging.
- `apps/public` — guest-facing React download page for cloud photo links.
- `packages/shared` — shared Zod schemas, IPC contracts, and domain types.
- `packages/ui` — `@grace-booth/ui` component library built with Base UI, Fluent UI, and Tailwind CSS v4 design tokens.
- `supabase` — database migrations, private storage policies, Edge Functions, cleanup scheduling, storage repair, and optional Google Photos sync.
- `tests/e2e` — Electron and visual Playwright coverage.

## Architecture

```text
Kiosk
  -> authenticated Supabase Edge Functions
  -> private Cloudflare R2 or private Supabase Storage
  -> token-authorized photo Edge Function
  -> Cloudflare Pages guest download site
```

| Layer                 | Responsibility                                                                                                                                                                                                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Electron renderer     | Owns the webcam `getUserMedia` stream and renders the guest, operator, recent-photo, and second-display interfaces. It has no direct Node.js, filesystem, SQLite, or secret access.                                                                                             |
| Typed preload bridge  | Validates request and response payloads with shared Zod IPC contracts before crossing between the renderer and Electron main process.                                                                                                                                           |
| Electron main process | Runs the durable workflow, camera adapters, frame service, encrypted photo vault, SQLite repositories, upload queue, local operator server, same-network delivery server, and display manager.                                                                                  |
| Image worker          | Validates JPEG/PNG inputs, applies EXIF orientation and each frame's ordered crop/fit slot geometry, composites the transparent overlay, and exports the final JPEG with Sharp.                                                                                                 |
| Supabase              | Owns Postgres data, booth authentication, forced RLS, upload authorization, confirmation, public token resolution, repair, and scheduled cleanup.                                                                                                                               |
| Private storage       | Stores each cloud object in the provider recorded on its photo-session row. New sessions use R2 when all four R2 settings are present; otherwise they use the private Supabase Storage fallback.                                                                                |
| Public download app   | Reads the 256-bit token from `/photo#<TOKEN>`, sends it only in strict POST bodies, receives verified JPEG bytes from the `photo` Function, displays them through a blob URL, and exposes the configured recruitment action. It never receives an R2 URL or storage credential. |

The active frame and its required shot count are locked when a guest starts a session. Captures, retake rounds, processing state, upload work, and ready receipts are persisted so interrupted work can be reconciled after restart. In dual-display mode, Screen 1 can return to Attract as soon as processing is handed off while the newest completed delivery appears on Screen 2.

### Cloud delivery contract

- `create-upload` and `confirm-upload` require a dedicated Supabase Auth booth-user JWT and verify that the user is enabled in `public.booth_devices`.
- New uploads go to R2 only when `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and `R2_BUCKET_NAME` are all configured. A partial set fails closed.
- Every `photo_sessions` row records `storage_backend`, so existing Supabase Storage objects remain readable, confirmable, cleanable, and repairable after an R2 cutover.
- `photo/resolve`, `photo/image`, and `photo/download` accept POST bodies containing the public token. Image and download routes return verified JPEG bytes through the Function for both backends; the browser does not access R2 directly.
- Public access ends exactly 720 hours after confirmation even if the daily cleanup job has not yet removed the object.
- Cleanup uses leased, idempotent claims. A never-ready tombstone can be reopened only by its owning booth under the guarded resume rules; a once-ready tombstone cannot have its public expiry extended.

## Implemented features

- Frame-driven sessions with 1–10 ordered photo slots, arbitrary frame aspect ratios, layer ordering, and per-slot `crop-to-fill` or `fit` behavior.
- Thirteen shipped three-photo layouts (two anniversary frames and eleven ministry frames), plus operator-imported transparent PNG frames. Visible frames with the session's locked shot count appear in **Choose your collage**.
- Built-in, USB, and virtual webcam capture with 720p or 1080p preferences, optional always-active webcam mode, deterministic mock captures for tests, and an explicitly unsupported native Sony PC Remote adapter.
- Whole-set retakes, two-press `Esc` cancellation during countdown/capture/review, restart recovery, and automatic upload retries after 1, 3, and 8 seconds.
- Single- or dual-display operation, a latest-result QR station with auto-dismiss, and a **Recent Photos** gallery for the last 20 completed collages.
- Cloud QR delivery through the private Supabase/R2 backend and a **Finish offline** recovery path that serves the collage from the booth on the local network.
- Passcode-protected frame management, camera setup, system health, upload inspection, recruitment copy, optional private-LAN HTTPS administration, display settings, and optional Google Photos sync.
- Fixed retention: cloud access expires after 30 days and local session media after 60 days.

## Requirements

### Packaged kiosk

- Windows 11 x64, or Windows 10 x64 covered by an active ESU agreement for production.
- A built-in, USB, or virtual UVC-compatible webcam.
- At least 1280 x 720 display resolution.
- Internet access for cloud QR delivery; same-network offline delivery remains available as a recovery choice.
- An optional second display configured in Windows as an extended desktop.

### Development and packaging

- Node.js 24.x.
- pnpm 11.x through Corepack.
- Git.
- At least 4 GB of free disk space for dependencies, test browsers, and package output.
- Docker Desktop or a compatible container runtime only for the local Supabase database and Storage suite.

Deno and Supabase CLI commands are provided by pinned workspace dependencies. Backend tooling is not required to install or operate an already packaged kiosk.

### Hosted deployment

- A Supabase account and a new production project in Southeast Asia (Singapore).
- A Cloudflare account with R2 enabled.
- GitHub or GitLab access for Cloudflare Pages Git integration.
- An optional production domain or subdomain. The generated `*.pages.dev` origin is sufficient when no custom domain is needed.

## Developer setup

Run from PowerShell:

```powershell
git clone https://github.com/mjpagarigan/photobooth-system.git
cd photobooth-system

corepack enable
node --version
pnpm --version
pnpm install --frozen-lockfile
```

Expected major versions:

```text
Node.js: 24
pnpm:    11
```

Install Chromium only when Playwright tests will be run:

```powershell
pnpm exec playwright install chromium
```

The checked-in lockfile and `allowBuilds` policy control installation. Sharp and better-sqlite3 use their compatible Windows x64 prebuilds; do not run a broad native rebuild for the pinned dependency graph.

## Configuration reference

Use `.env.example` as a name and placeholder reference, but never commit a populated `.env` file. Development builds can load a root or kiosk `.env`; inherited PowerShell variables take precedence. Packaged builds deliberately do not load project `.env` files.

The current public application consumes only `VITE_PUBLIC_PHOTO_API_URL` and `VITE_PUBLIC_PAGE_ORIGIN`. `.env.example` still contains the legacy `VITE_PUBLIC_R2_ORIGIN` name, but current public code does not consume it because R2 bytes are served through the Supabase `photo` Function. Do not configure it for a new deployment.

| Value                                  | Purpose                                      | Location                                             | Browser-safe? | Never place in                                      |
| -------------------------------------- | -------------------------------------------- | ---------------------------------------------------- | ------------- | --------------------------------------------------- |
| `GRACE_BOOTH_CAMERA_ADAPTER`           | Selects `webcam` or development-only `mock`  | Development shell or root `.env`                     | No            | Public Pages variables                              |
| `GRACE_BOOTH_SUPABASE_URL`             | Custom Supabase project URL                  | Development environment or approved kiosk settings   | Yes           | —                                                   |
| `GRACE_BOOTH_SUPABASE_PUBLISHABLE_KEY` | Low-privilege client API key                 | Development environment or approved kiosk settings   | Yes           | Server-secret fields                                |
| Booth email/password                   | Authenticates one physical booth             | Kiosk Admin cloud-connection form                    | No            | Git, Pages, SQLite, logs, or Dashboard-user account |
| `VITE_PUBLIC_PHOTO_API_URL`            | Public `photo` Function base URL             | Cloudflare Pages production build variables          | Yes           | —                                                   |
| `VITE_PUBLIC_PAGE_ORIGIN`              | Exact deployed public-page origin            | Cloudflare Pages production build variables          | Yes           | —                                                   |
| `SUPABASE_URL`                         | Function project URL                         | Supabase-provided when hosted; local Function env    | Yes           | —                                                   |
| `SUPABASE_SECRET_KEY`                  | Local Function server credential             | Ignored `supabase/.env.local` only                   | No            | Electron, Vite, Pages, SQLite, or logs              |
| `PUBLIC_TOKEN_DERIVATION_KEY`          | HMAC derivation key for stable public tokens | Supabase Edge Function secrets                       | No            | Electron, Vite, Pages, SQLite, or logs              |
| `PUBLIC_PAGE_ORIGIN`                   | Exact allowed browser origin                 | Supabase Edge Function secrets                       | Not secret    | Values containing a path or trailing slash          |
| `PHOTO_BUCKET`                         | Supabase Storage fallback bucket             | Supabase Edge Function secrets; defaults to `photos` | No            | Browser configuration                               |
| `CLEANUP_SECRET`                       | Authenticates scheduled cleanup              | Function secrets and matching Vault entry            | No            | Electron, Vite, Pages, SQLite, or logs              |
| `R2_ACCOUNT_ID`                        | Selects the Cloudflare account               | Supabase Edge Function secrets                       | No            | Electron, Vite, Pages, SQLite, or logs              |
| `R2_ACCESS_KEY_ID`                     | R2 S3-compatible credential                  | Supabase Edge Function secrets                       | No            | Electron, Vite, Pages, SQLite, or logs              |
| `R2_SECRET_ACCESS_KEY`                 | R2 S3-compatible secret                      | Supabase Edge Function secrets                       | No            | Electron, Vite, Pages, SQLite, or logs              |
| `R2_BUCKET_NAME`                       | Private R2 bucket                            | Supabase Edge Function secrets                       | No            | Public application configuration                    |
| `GOOGLE_CLIENT_ID`                     | Optional Google OAuth application ID         | Supabase Edge Function secrets                       | No            | Kiosk or Pages configuration                        |
| `GOOGLE_CLIENT_SECRET`                 | Optional Google OAuth secret                 | Supabase Edge Function secrets                       | No            | Electron, Vite, Pages, SQLite, or logs              |

The kiosk accepts only a project URL and publishable/legacy-anon key. Never enter an `sb_secret_...` key or legacy `service_role` key in the desktop application.

## Run locally

### Kiosk and public page

The kiosk defaults to the system webcam. Use the deterministic fixture adapter only for development:

```powershell
$env:GRACE_BOOTH_CAMERA_ADAPTER = 'mock'
pnpm dev:kiosk
```

Start only the public application:

```powershell
pnpm dev:public
```

The public page expects `/photo#<32-BYTE-BASE64URL-TOKEN>`. Its browser tests use a controlled local Function stub; an ordinary local page cannot resolve a hosted photo unless its API and exact origin match the hosted project.

Only one development or packaged kiosk should run at a time. It reserves `127.0.0.1:4311` for local operator access and `0.0.0.0:4310` for offline photo delivery. Stop development with `Ctrl+C` before packaging.

### Local Supabase

Docker Desktop or Podman is required for the local database and Storage suite:

```powershell
pnpm supabase:start
pnpm db:reset
pnpm exec supabase test db supabase/tests/database --local --workdir supabase
```

Place local-only Function values and the local server key printed by `supabase status` in the ignored `supabase/.env.local`, then serve Functions with:

```powershell
pnpm functions:serve
```

Edge code checks do not require containers:

```powershell
pnpm functions:check
pnpm functions:lint
pnpm functions:format:check
pnpm test:functions
```

The live integration suite deliberately refuses non-loopback targets. With the local stack and Functions running:

```powershell
$env:GRACE_BOOTH_RUN_SUPABASE_INTEGRATION = '1'
$env:SUPABASE_URL = 'http://127.0.0.1:54321'
$env:SUPABASE_PUBLISHABLE_KEY = '<LOCAL-PUBLISHABLE-KEY>'
$env:SUPABASE_SECRET_KEY = '<LOCAL-SECRET-KEY>'
$env:CLEANUP_SECRET = '<SAME-LOCAL-CLEANUP-SECRET>'
$env:PUBLIC_PAGE_ORIGIN = 'http://127.0.0.1:4173'
pnpm test:supabase:integration
```

Never aim this suite at a hosted project.

## First kiosk configuration

There is no default operator passcode, and `7777` is deliberately rejected.

1. Launch the kiosk under the dedicated Windows booth account.
2. Create the required 8–64-character operator passcode and store it in the organization's approved password manager.
3. Open **Admin > Settings & health > Capture hardware > Configure camera and test feed**.
4. Select the built-in or USB webcam, choose 720p or 1080p, and confirm the preview. Prefer 1080p for production; 720p remains supported for virtual cameras and testing.
5. Enable **Keep webcam always active** only when the booth needs a warm invisible stream throughout the guest flow. It is off by default.
6. Obtain the dedicated booth-account email and password from the Supabase project owner.
7. Under **Cloud connection**, leave the project URL and publishable-key fields blank for the official embedded project. For a custom deployment, enter the matching custom project URL and publishable key. Enter the booth email/password and choose **Connect cloud**.
8. Confirm camera, database, encrypted storage, and cloud health.
9. Inspect the frame library. Imported frames may use 1–10 slots and any aspect ratio; visible layouts with the session's shot count appear during review.
10. Run a complete session, including a retake, processing, QR scan, download, and **Done**.

Passcodes use serialized scrypt with a fresh 32-byte salt, a 64-byte result, `N=131072`, `r=8`, and `p=1`. Failed attempts are rate-limited; changing the passcode revokes current admin sessions. Leaving Admin re-locks operator controls.

Runtime data lives under `%APPDATA%\@grace-booth\kiosk`. Do not move or copy individual encrypted assets. Recovery depends on the database, sealed installation key, secret store, and encrypted asset tree remaining together in the same Windows user profile.

### Frame editor and settings

The Frame Editor accepts a decoded PNG only when it:

- Is no larger than 5 MiB.
- Has real transparency.
- Decodes within the image safety limits.

Packaged legacy photostrips are 1200 x 3600, but imported frames may use arbitrary aspect ratios and 1–10 ordered slots. Each slot has keyboard-equivalent percentage fields and supports crop-to-fill or fit. Saves are revision-checked and atomic. Release-managed artwork refreshes only the exact built-in ministry names while preserving operator-edited geometry; operator-imported frames are never overwritten.

Frame preparation commands are available from the repository root:

```powershell
pnpm --filter @grace-booth/kiosk frame:build <SOURCE.PNG> [TARGET.PNG]
pnpm --filter @grace-booth/kiosk frame:verify
pnpm --filter @grace-booth/kiosk frames:prepare --all <TEMPLATE-DIRECTORY>
```

Admin Settings also exposes upload retry, passcode change, camera/cloud health, retention status, dual-display controls, recruitment copy, and optional LAN administration.

### Optional LAN HTTPS administration

Fastify binds to loopback only by default. Keep that default unless remote administration is explicitly approved. LAN access requires all of the following:

1. Select one concrete RFC1918 private interface in Admin Settings.
2. Supply a trusted HTTPS PFX and its passphrase.
3. Confirm that the certificate identity matches the private hostname or IP used by operators.
4. Create a narrowly scoped Windows Firewall rule for that executable, port, interface, and Private network profile.
5. Test from the trusted private network.

Grace Booth never binds LAN administration to `0.0.0.0`, never accepts a public interface, and never falls back to plaintext LAN HTTP. Invalid interface or certificate configuration disables LAN access while leaving loopback access available. The application does not create or remove firewall rules automatically.

## Guest and operator workflows

### Guest flow

1. The attract screen starts a session and locks the active frame and its 1–10 shot count.
2. The first photo uses an eight-second countdown; every remaining photo uses five seconds.
3. **Choose your collage** previews the captured set in every visible compatible frame.
4. **Retake all photos** replaces the complete set; **Use these photos** continues with the selected frame.
5. Processing creates and encrypts the local collage, then attempts delivery. Cloud retries wait 1, 3, and 8 seconds before recovery choices appear.
6. A successful cloud confirmation produces the public QR. If cloud delivery cannot finish, **Finish offline** creates a same-network link served by the booth.
7. **Done** returns a single display to Attract. In dual-display mode Screen 1 already resets after acceptance while Screen 2 receives the newest delivery.

Press `Esc` twice within two seconds during countdown, capture, or review to cancel the in-progress session and remove its captured files. A single press only arms the confirmation hint. Upload failure never discards the local collage, and restart recovery resumes valid persisted work.

### Camera acceptance

For an acceptance run, complete the active frame's configured shot count, perform at least one complete retake, accept the replacement set, observe processing and upload milestones, scan the QR, download the result, and verify restart recovery. Without a cloud project, confirm that the recovery screen says the photo remains saved locally.

For a Sony ILCE-7M4, use 1080p USB Streaming over USB 3/SuperSpeed and select its UVC webcam entry. Do not set `GRACE_BOOTH_CAMERA_ADAPTER=sony` for guest operation: the native PC Remote adapter remains gated pending the exact camera, firmware, official SDK, redistribution terms, byte-transfer behavior, USB acceptance suite, and twenty-capture soak test.

### Dual displays

In Windows **Display settings**, choose **Extend these displays**. Duplicate/Mirror mode cannot host the delivery window.

- Screen 1 shows Attract, countdowns, the live viewfinder, and review.
- Screen 2 shows the idle M.A.T. background and **Recent** control, or the latest collage, QR, recruitment action, and timer.

Open **Admin > Settings & health > Displays** to select `Auto`, `Force Enabled`, or `Disabled`, swap displays, and choose a 30/45/60/90-second QR auto-dismiss timer. A newer result replaces an older result and restarts the timer; late older results cannot overwrite it.

## Complete backend setup from scratch

This workflow creates a new Supabase database/Auth/Function backend, private Cloudflare R2 storage, and a Cloudflare Pages download site. Run terminal commands from the repository root unless a different location is stated.

The two configuration blocks below serve different purposes. **Use the block in [step 6](#6-configure-hosted-function-secrets) for hosted backend configuration.**

| Block                                                                   | Purpose                                                                                                     | Where it belongs                                                                                           |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| [Step 1: deployment worksheet](#1-collect-deployment-values)            | Collects values used throughout project setup, booth enrollment, kiosk configuration, and Pages deployment. | Approved password manager; this is not a runtime environment file.                                         |
| [Step 6: hosted Function secrets](#6-configure-hosted-function-secrets) | Configures the backend's token generation, public origin, cleanup, and private storage.                     | Ignored `supabase/.env.deploy.local`, uploaded to the linked Supabase project with `supabase secrets set`. |

### 1. Collect deployment values

Keep this deployment worksheet in an approved password manager, not in Git. Fill it in as you complete the setup steps; the booth Auth UUID is created in step 9. Do not pass this worksheet to `supabase secrets set` or use it as the kiosk or public app's `.env` file:

```text
SUPABASE_PROJECT_REF=<SUPABASE_PROJECT_REF>
SUPABASE_PROJECT_URL=https://<SUPABASE_PROJECT_REF>.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_<VALUE>
R2_BUCKET_NAME=<R2_BUCKET_NAME>
CLOUDFLARE_ACCOUNT_ID=<CLOUDFLARE_ACCOUNT_ID>
R2_ACCESS_KEY_ID=<R2_ACCESS_KEY_ID>
R2_SECRET_ACCESS_KEY=<R2_SECRET_ACCESS_KEY>
PUBLIC_PAGE_ORIGIN=https://<PAGES_PROJECT>.pages.dev
BOOTH_EMAIL=<BOOTH_EMAIL>
BOOTH_AUTH_USER_UUID=<BOOTH_AUTH_USER_UUID>
```

`CLOUDFLARE_ACCOUNT_ID` is a worksheet label for your Cloudflare Account ID. Copy that value into **`R2_ACCOUNT_ID`** in step 6; the backend reads `R2_ACCOUNT_ID` and does not read `CLOUDFLARE_ACCOUNT_ID`. `PUBLIC_TOKEN_DERIVATION_KEY` and `CLEANUP_SECRET` are generated separately in step 5 and added to the step 6 file.

### 2. Create the Supabase project

1. Sign in at [Supabase](https://supabase.com/dashboard) and create a project.
2. Select **Southeast Asia (Singapore)**. Region selection is permanent for the project; use another region only after an explicit architecture decision.
3. Generate a strong database password, store it in the approved password manager, and wait for provisioning to finish.
4. Record the project reference from the project URL or project settings.
5. Open the project's **Connect** dialog to copy the project URL and publishable key. To inspect or create a specific modern key, open **Settings > API Keys** and use an `sb_publishable_...` key.

Publishable keys are designed for shipped clients and remain constrained by Auth and RLS. `sb_secret_...` and legacy `service_role` keys bypass RLS and must never enter Electron, Cloudflare Pages, browser code, or logs. See the official [API-key guide](https://supabase.com/docs/guides/getting-started/api-keys) and [region list](https://supabase.com/docs/guides/platform/regions).

### 3. Link the project and apply migrations

Authenticate the pinned CLI, link the repository, and apply every checked-in migration:

```powershell
pnpm exec supabase login
pnpm exec supabase link --project-ref <SUPABASE_PROJECT_REF> --workdir supabase
pnpm exec supabase db push --workdir supabase
```

Expected result: the CLI reports a linked project and applies the pending files under `supabase/migrations`. Do not run `db reset` against production.

The `photos` Supabase Storage bucket is a fallback, not an R2 requirement. Materialize it only when the deployment must support new uploads without R2:

```powershell
pnpm exec supabase seed buckets --linked --workdir supabase
```

With all four R2 settings configured, new sessions use R2 and do not require the fallback bucket. Existing rows still use the backend recorded on each row.

### 4. Create private Cloudflare R2 storage

1. In the [Cloudflare dashboard](https://dash.cloudflare.com/), open **Storage & databases > R2 > Overview**.
2. Select **Create bucket**, choose a valid lowercase bucket name, select the approved location/storage class if prompted, and create it.
3. Keep public access disabled. The bucket is not the guest website.
4. Record the bucket name and Cloudflare Account ID.
5. On the R2 Overview page, select **Manage** beside **API Tokens**.
6. Create an Account or User R2 token with **Object Read & Write**, scoped to this bucket only.
7. Copy the Access Key ID and Secret Access Key immediately; the secret is shown once.

The Functions use the S3-compatible R2 API. Guests receive JPEG bytes only from the Supabase `photo` Function, so no R2 public domain, browser-facing bucket CORS policy, or public-app R2 origin is required. See Cloudflare's [bucket](https://developers.cloudflare.com/r2/buckets/create-buckets/) and [R2 token](https://developers.cloudflare.com/r2/api/tokens/) guides.

Optional equivalent bucket commands:

```powershell
npx wrangler login
npx wrangler r2 bucket create <R2_BUCKET_NAME>
npx wrangler r2 bucket list
```

Wrangler is not pinned in this workspace, so `npx` may download it for these optional commands.

### 5. Generate independent application secrets

Generate the token-derivation and cleanup values independently in PowerShell:

```powershell
$derivationBytes = [byte[]]::new(32)
[Security.Cryptography.RandomNumberGenerator]::Fill($derivationBytes)
$publicTokenDerivationKey = [Convert]::ToBase64String($derivationBytes)

$cleanupBytes = [byte[]]::new(32)
[Security.Cryptography.RandomNumberGenerator]::Fill($cleanupBytes)
$cleanupSecret = [Convert]::ToBase64String($cleanupBytes)
```

Store both in the approved password manager. Do not print them into logs, reuse one value for both purposes, or rotate `PUBLIC_TOKEN_DERIVATION_KEY` while pending uploads may still be replayed.

### 6. Configure hosted Function secrets

Create `supabase/.env.deploy.local` with a trusted editor. The repository's `.gitignore` ignores `.env.*` files; verify before adding secrets:

```powershell
git check-ignore supabase/.env.deploy.local
```

Populate the ignored file with the hosted backend runtime configuration below, replacing every placeholder with its actual value. Do not commit it:

```dotenv
PUBLIC_TOKEN_DERIVATION_KEY=<PUBLIC_TOKEN_DERIVATION_KEY>
PUBLIC_PAGE_ORIGIN=https://<PAGES_PROJECT>.pages.dev
PHOTO_BUCKET=photos
CLEANUP_SECRET=<CLEANUP_SECRET>
R2_ACCOUNT_ID=<CLOUDFLARE_ACCOUNT_ID>
R2_ACCESS_KEY_ID=<R2_ACCESS_KEY_ID>
R2_SECRET_ACCESS_KEY=<R2_SECRET_ACCESS_KEY>
R2_BUCKET_NAME=<R2_BUCKET_NAME>
```

Do not copy the entire step 1 worksheet into this file. `SUPABASE_PROJECT_REF` is used to link the CLI; `SUPABASE_PROJECT_URL` and `SUPABASE_PUBLISHABLE_KEY` are used for kiosk setup; `BOOTH_EMAIL` and `BOOTH_AUTH_USER_UUID` are used for booth authentication and enrollment. Hosted Functions receive `SUPABASE_URL` and server credentials from Supabase automatically. Custom secret names beginning with `SUPABASE_` are reserved and cannot be uploaded. See Supabase's [Function environment variables guide](https://supabase.com/docs/guides/functions/secrets).

`PHOTO_BUCKET=photos` names the Supabase Storage fallback bucket, not the R2 bucket. The R2 bucket is selected by `R2_BUCKET_NAME`. For a deployment using only Supabase Storage, omit all four `R2_*` entries and create the fallback bucket as described in step 3; a partial R2 configuration fails closed.

Push the values and verify only their names/digests:

```powershell
pnpm exec supabase secrets set --env-file supabase/.env.deploy.local --workdir supabase
pnpm exec supabase secrets list --workdir supabase
```

Expected result: every required name appears. Supabase makes updated secrets available to hosted Functions without exposing their values. Keep or securely remove the local deploy file according to the organization's secret-handling policy.

`PUBLIC_PAGE_ORIGIN` must be an exact origin: scheme plus hostname, with no path, query, fragment, credentials, or trailing slash. Non-local deployments require HTTPS.

### 7. Configure Vault and scheduled cleanup

The cleanup migration registers one daily Cron/`pg_net` job at `17 19 * * *` UTC. It reads only two named Vault entries; do not create a second cleanup schedule manually.

In **Supabase Dashboard > SQL Editor**, first check names without reading decrypted values:

```sql
select id, name, created_at, updated_at
from vault.secrets
where name in ('grace_booth_project_url', 'grace_booth_cleanup_secret');
```

For first-time setup, create missing entries:

```sql
select vault.create_secret(
  'https://<SUPABASE_PROJECT_REF>.supabase.co',
  'grace_booth_project_url'
);

select vault.create_secret(
  '<SAME_VALUE_AS_CLEANUP_SECRET>',
  'grace_booth_cleanup_secret'
);
```

If an entry already exists, update its UUID rather than creating a duplicate:

```sql
select vault.update_secret(
  (select id from vault.secrets where name = 'grace_booth_project_url'),
  'https://<SUPABASE_PROJECT_REF>.supabase.co',
  'grace_booth_project_url'
);

select vault.update_secret(
  (select id from vault.secrets where name = 'grace_booth_cleanup_secret'),
  '<SAME_VALUE_AS_CLEANUP_SECRET>',
  'grace_booth_cleanup_secret'
);
```

Verify one registered job without displaying secrets:

```sql
select jobname, schedule, active
from cron.job
where jobname = 'grace-booth-cleanup-expired';
```

Expected result: exactly one active daily job. The Vault cleanup value must exactly match the Function `CLEANUP_SECRET`.

### 8. Deploy the core Edge Functions

Deploy only the required delivery Functions:

```powershell
pnpm exec supabase functions deploy create-upload confirm-upload photo repair-photo cleanup-expired --workdir supabase
```

The checked-in `supabase/config.toml` keeps JWT verification enabled for booth-authenticated Functions and disabled for the public or secret-authenticated endpoints. Do not override those settings on the command line.

Expected result: **Supabase Dashboard > Edge Functions** lists the five Functions. Inspect their deployment logs for bundling failures. Google Photos Functions are optional and are deployed separately later.

### 9. Create and enroll a booth Auth user

Create a separate Auth identity for every physical booth:

1. Open **Supabase Dashboard > Authentication > Users**.
2. Choose **Add user** and create or invite the dedicated booth email. Do not reuse a human Dashboard administrator.
3. Ensure the user is confirmed and can authenticate, then copy its Auth UUID.
4. In SQL Editor, enroll it:

```sql
insert into public.booth_devices (user_id, device_name)
values ('<BOOTH_AUTH_USER_UUID>', 'Main booth');
```

Verify enrollment without exposing credentials:

```sql
select user_id, device_name, enabled, created_at
from public.booth_devices
where user_id = '<BOOTH_AUTH_USER_UUID>';
```

Expected result: one enabled row for that booth. Supply the email/password securely to the kiosk operator; the operator does not need Supabase Dashboard access.

### 10. Create the Cloudflare Pages project

Use Git integration as the canonical deployment path:

1. Open **Cloudflare Dashboard > Workers & Pages**.
2. Create a Pages application, connect GitHub or GitLab, and authorize only the required repository.
3. Select the repository and production branch.
4. Configure:

   ```text
   Framework preset: None
   Root directory: leave unset (repository root)
   Build command: pnpm build
   Build output directory: apps/public/dist
   ```

5. Under the Pages project's production **Settings > Variables and Secrets**, add only:

   ```text
   VITE_PUBLIC_PHOTO_API_URL=https://<SUPABASE_PROJECT_REF>.supabase.co/functions/v1/photo
   VITE_PUBLIC_PAGE_ORIGIN=https://<PAGES_PROJECT>.pages.dev
   ```

6. Save and deploy. Inspect the build log and open the generated production URL.

The public variables are embedded at build time. Never add R2 credentials, Supabase secret keys, booth credentials, token-derivation keys, or cleanup secrets to Pages. Preview deployments have different origins and are intentionally rejected by the production Function's exact-origin check unless a separate environment is designed for them.

See Cloudflare's [Git integration](https://developers.cloudflare.com/pages/get-started/git-integration/) and [build configuration](https://developers.cloudflare.com/pages/configuration/build-configuration/) documentation.

### 11. Keep the public origin synchronized

The following values must match byte-for-byte:

```text
Supabase Function secret: PUBLIC_PAGE_ORIGIN
Cloudflare Pages variable: VITE_PUBLIC_PAGE_ORIGIN
Browser production origin: window.location.origin
```

A trailing slash, path, preview hostname, or different custom domain causes a `403`.

For a custom domain:

1. Open the Pages project, choose **Custom domains > Set up a domain**, and complete the required DNS setup.
2. Wait for domain and certificate activation.
3. Change the Pages production `VITE_PUBLIC_PAGE_ORIGIN` to the exact custom origin.
4. Change `PUBLIC_PAGE_ORIGIN` in `supabase/.env.deploy.local` and run `supabase secrets set` again.
5. Trigger a new Pages production build.
6. Supabase secrets update immediately; redeploy the current Functions as part of the release only when the deployment policy requires code/config parity.
7. Create a fresh photo session and retest the complete QR flow.

See Cloudflare's [custom-domain guide](https://developers.cloudflare.com/pages/configuration/custom-domains/).

### 12. Verify the public build locally

Set production-like public values and build from the repository root:

```powershell
$env:VITE_PUBLIC_PHOTO_API_URL = 'https://<SUPABASE_PROJECT_REF>.supabase.co/functions/v1/photo'
$env:VITE_PUBLIC_PAGE_ORIGIN = 'https://<PAGES_PROJECT>.pages.dev'
pnpm --filter @grace-booth/public build
```

Check for unresolved or inert values and inspect the generated Cloudflare files:

```powershell
Select-String -Path apps/public/dist/index.html -Pattern '__[A-Z0-9_]+__|unconfigured.*\.invalid'
Get-Content apps/public/dist/_headers
```

Expected result: `Select-String` returns no matches and `_headers` contains a CSP whose `connect-src` is the exact Supabase API origin. Cloudflare Pages applies its default single-page-application fallback because this build has no top-level `404.html`; the checked-in `wrangler.jsonc` declares the equivalent fallback for Wrangler static assets. A successful build does not by itself prove that the hosted backend is reachable.

The generated response rules keep `/photo` private, non-cacheable, and unindexed while allowing immutable caching for hashed `/assets/*` files. The HTML CSP and Cloudflare response CSP must remain identical and free of unsafe script/style directives.

The checked-in `wrangler.jsonc` can serve the same `apps/public/dist` output as a static-assets Worker, but Cloudflare Pages Git integration is the documented production route.

### 13. Connect the custom kiosk

Development builds can use:

```env
GRACE_BOOTH_SUPABASE_URL=https://<SUPABASE_PROJECT_REF>.supabase.co
GRACE_BOOTH_SUPABASE_PUBLISHABLE_KEY=sb_publishable_<VALUE>
```

Set both values or neither. Packaged builds do not read project `.env` files; use the approved embedded production values or the Admin custom-project fields. Enter the dedicated booth email/password through **Admin > Settings & health > Cloud connection**. The password is cleared after submission and the resulting session is sealed in Electron main with Windows DPAPI.

### 14. End-to-end acceptance checklist

- [ ] All checked-in migrations are applied.
- [ ] Forced RLS and denied direct client access are present.
- [ ] Exactly one daily cleanup Cron job is active.
- [ ] Both named Vault entries exist without duplicates.
- [ ] All required Function secret names are present.
- [ ] The five core Functions are deployed.
- [ ] The R2 bucket is private.
- [ ] The R2 token has Object Read & Write for only the intended bucket.
- [ ] The dedicated Auth user is confirmed and enabled in `booth_devices`.
- [ ] The Pages production build succeeds without unresolved placeholders.
- [ ] `PUBLIC_PAGE_ORIGIN` and `VITE_PUBLIC_PAGE_ORIGIN` are identical.
- [ ] No production secret is present in Pages variables or kiosk configuration.
- [ ] A mock or real kiosk session creates an R2 object after **Use these photos**.
- [ ] The QR opens `https://<PUBLIC_PAGE_ORIGIN>/photo#<TOKEN>`.
- [ ] Preview and download succeed without CSP or CORS errors.
- [ ] Missing and expired tokens reveal neither storage paths nor provider details.

### Storage-backend recovery

After the repair migration and Functions are deployed, run the administrator inventory from the repository root. It is dry-run-only unless every apply guard is supplied:

```powershell
pnpm repair:storage-backends
pnpm repair:storage-backends -- --apply --batch-id <NEW-UUID> --confirm-count <R2-VERIFIED-COUNT>
pnpm repair:storage-backends -- --rollback-batch <BATCH-UUID>
```

Review the complete dry run before applying. Apply rescans the inventory, changes only `r2-verified` rows, and records changes in the service-role-only ledger. Rollback restores only matching metadata and never deletes objects. Recover `missing-both` items individually from the original kiosk through **Recent Photos**.

## Optional Google Photos live album sync

Google Photos synchronization is not required for capture, R2 delivery, QR creation, or guest download. Complete the core backend first.

The `20260829000000_google_photos_sync.sql` migration creates `google_photos_config`, `google_sync_queue`, and the ready-session enqueue trigger. The worker reads from the backend recorded on the photo row, processes up to five leased jobs, and retries failures up to ten times with capped exponential delays without blocking the guest QR response.

### Google Cloud setup

1. Create or select a project in [Google Cloud Console](https://console.cloud.google.com/).
2. Open **APIs & Services > Library** and enable **Photos Library API**.
3. Configure the OAuth consent screen as External, or Internal for an eligible Workspace organization.
4. Configure the scopes currently requested by `google-photos-auth`:
   - `https://www.googleapis.com/auth/photoslibrary`
   - `https://www.googleapis.com/auth/photoslibrary.sharing`
   - `https://www.googleapis.com/auth/photoslibrary.appendonly`
   - `https://www.googleapis.com/auth/photoslibrary.readonly.appcreateddata`
   - `https://www.googleapis.com/auth/userinfo.email`
5. Add the organizer as a test user when the consent app remains in Testing.
6. Under **Credentials > Create credentials > OAuth client ID**, choose **Web application** and add:

   ```text
   https://<SUPABASE_PROJECT_REF>.supabase.co/functions/v1/google-photos-auth
   ```

7. Store the Client ID and Client Secret in Supabase Function secrets, never in the kiosk or public app:

   ```powershell
   pnpm exec supabase secrets set --workdir supabase `
     GOOGLE_CLIENT_ID=<GOOGLE_CLIENT_ID> `
     GOOGLE_CLIENT_SECRET=<GOOGLE_CLIENT_SECRET>
   ```

8. Deploy the optional Functions:

   ```powershell
   pnpm exec supabase functions deploy google-photos-auth sync-google-photos --workdir supabase
   ```

### Kiosk configuration

1. Open **Admin > Settings & health > Google Photos** and enable live sync.
2. Authorize the organizer's Google account, return to the kiosk, and check authorization status.
3. Create and select a shared event album. The implemented sync path targets an album created by this application; manually created consumer albums are not supported targets.
4. Save the configuration and copy the guest album link if needed.
5. Use **Send Test Photo** and **Sync Pending Now**, and monitor synced, pending, and failed counters.

Google failure does not invalidate an already-confirmed QR delivery. Leave failed jobs queued and use the operator controls after credentials and network access are restored.

## Build and install the Windows kiosk

### Package the application

Close the installed app and stop `pnpm dev:kiosk` with `Ctrl+C`. Confirm that the kiosk ports are free:

```powershell
Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
  Where-Object { $_.LocalPort -in 4310, 4311 } |
  Select-Object LocalAddress, LocalPort, OwningProcess
```

No rows should be returned. Restore and verify the source:

```powershell
pnpm install --frozen-lockfile
pnpm --filter @grace-booth/kiosk typecheck
pnpm --filter @grace-booth/kiosk test
pnpm --filter @grace-booth/kiosk build
pnpm native:self-test
```

Create the unsigned Windows x64 NSIS package:

```powershell
pnpm dist:win
```

The command builds the kiosk, packages Electron, and launches `win-unpacked/Grace Booth.exe --native-self-test`. A passing final record resembles:

```json
{ "ok": true, "sqlite": true, "sharp": true, "worker": true, "safeStorage": true }
```

Outputs:

- `apps/kiosk/release/Grace-Booth-<VERSION>-x64-setup.exe`
- `apps/kiosk/release/win-unpacked/Grace Booth.exe`

Cross-platform Sharp notices about Darwin, Linux, ARM, or musl are not Windows x64 failures when the final packaged native self-test passes.

Run the packaged startup smoke test:

```powershell
pnpm --filter @grace-booth/kiosk startup:smoke:packaged
```

It launches the unpacked app with an isolated temporary profile, completes bootstrap when needed, verifies the attract screen, writes `test-results/packaged-attract.png`, and closes without altering the normal kiosk profile.

### Install and accept the package

1. Copy the newly built installer to a clean Windows 11 test account.
2. Stop any development or older Grace Booth process.
3. Run the per-user installer and launch Grace Booth.
4. Complete first-run passcode and camera setup.
5. Run a complete mock session and retake round.
6. Test restart recovery during partial capture, processing, upload, and Final.
7. Confirm Sharp, better-sqlite3, migrations, encrypted media, local protocols, and the image worker work from the packaged ASAR layout.
8. Uninstall and confirm application binaries are removed. Treat retained application data under the organization's media-retention policy.

The installer is unsigned and intended for internal verification. A production release still requires an Authenticode certificate and signing workflow.

Normal application data is stored under `%APPDATA%\@grace-booth\kiosk`. Do not delete this directory as a general troubleshooting step; it contains the database, protected key material, encrypted photos, frame data, staging data, and logs.

## Verification

### Kiosk-only checks

```powershell
pnpm --filter @grace-booth/kiosk typecheck
pnpm --filter @grace-booth/kiosk test
pnpm --filter @grace-booth/kiosk build
pnpm native:self-test
pnpm native:self-test:packaged
pnpm --filter @grace-booth/kiosk startup:smoke:packaged
```

The packaged commands require an existing `apps/kiosk/release/win-unpacked` output. Run `pnpm dist:win` first when it is missing or stale.

### Backend checks

```powershell
pnpm functions:check
pnpm functions:lint
pnpm functions:format:check
pnpm test:functions
```

With Docker available:

```powershell
pnpm supabase:start
pnpm db:reset
pnpm exec supabase test db supabase/tests/database --local --workdir supabase
```

The pgTAP suite covers schema, forced RLS, denied direct access, private fallback storage, absolute expiry, idempotent creates, generation-bound confirmation, pending recovery, cleanup leases/tombstones, and Cron registration.

### Repository-wide checks

```powershell
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm build:all
pnpm test:e2e
pnpm native:self-test
```

The visual suite covers deterministic states at 1366 x 768 and 1280 x 720, including accessibility, overflow, bundled-font readiness, reduced motion, and third-party-request checks. Screenshot-baseline updates are intentional review actions, never automatic CI work. Record unavailable hosted-project or physical-camera checks as blocked instead of replacing them with simulated evidence.

## Troubleshooting

### “Grace Booth could not start”

Common causes include another process using port 4310 or 4311, incomplete packaged native modules, missing resources, or damaged local configuration.

1. Close Grace Booth and stop any `pnpm dev:kiosk` terminal.
2. Inspect listeners:

   ```powershell
   Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
     Where-Object { $_.LocalPort -in 4310, 4311 } |
     Select-Object LocalAddress, LocalPort, OwningProcess
   ```

3. Identify a returned PID before stopping it:

   ```powershell
   Get-CimInstance Win32_Process -Filter "ProcessId = <PID>" |
     Select-Object ProcessId, Name, ExecutablePath, CommandLine
   ```

4. Stop only a verified stale Grace Booth/Electron process:

   ```powershell
   Stop-Process -Id <PID>
   ```

5. Retest the package:

   ```powershell
   pnpm native:self-test:packaged
   pnpm --filter @grace-booth/kiosk startup:smoke:packaged
   ```

Do not delete `%APPDATA%\@grace-booth\kiosk` to resolve startup errors.

### Installer or native modules are stale

`pnpm --filter @grace-booth/kiosk build` does not refresh the installer. Stop every kiosk instance, confirm Node 24 and pnpm 11, then run:

```powershell
pnpm install --frozen-lockfile
pnpm dist:win
Get-Item 'apps/kiosk/release/Grace-Booth-*-x64-setup.exe' |
  Select-Object Name, Length, LastWriteTime
```

Use the final native-test JSON, not optional-package notices, as the pass/fail result.

### `Error: Electron uninstall` during development

Electron's binary download was skipped, interrupted, or blocked:

```powershell
pnpm rebuild electron
pnpm dev:kiosk
```

If dependencies are incomplete, run `pnpm install --force`. On restricted networks, configure an approved Electron mirror before rebuilding.

### Camera preview is blank or capture fails

1. Close other programs using the webcam.
2. In Windows **Privacy & security > Camera**, allow camera and desktop-app access.
3. Open **Admin > Settings & health > Overview > Configure camera and test feed**.
4. Select the intended device and 720p or 1080p preference, then verify the negotiated feed.
5. For Sony ILCE-7M4, use 1080p USB Streaming over USB 3/SuperSpeed and choose the UVC entry, not native PC Remote.
6. Reconnect the camera or restart the kiosk when the device list is stale.

### Backend setup failures

| Symptom                                             | Check and correction                                                                                                                                                   |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CLI cannot link                                     | Confirm `supabase login`, project reference, Dashboard access, network/DNS, and the stored database password.                                                          |
| `db push` cannot connect                            | Confirm the linked project, database password, project health, and network access. Never substitute a remote `db reset`.                                               |
| Function reports missing R2 configuration           | Set all four R2 values. Any partial group intentionally fails closed.                                                                                                  |
| Booth is unauthorized                               | Confirm the Auth user is active, credentials belong to that project, and its UUID has an enabled `booth_devices` row.                                                  |
| R2 upload fails                                     | Confirm the bucket name, Account ID, token Access Key/Secret, bucket-scoped Object Read & Write permission, system time, and Function logs.                            |
| QR page returns `403`                               | Compare the browser origin, `VITE_PUBLIC_PAGE_ORIGIN`, and `PUBLIC_PAGE_ORIGIN` byte-for-byte. Remove paths and trailing slashes.                                      |
| Pages preview fails while production works          | Preview hostnames differ from the approved production origin and are rejected by design.                                                                               |
| Pages uses stale values                             | Update production variables and trigger a new production build; Vite variables are compiled into the bundle.                                                           |
| R2 object exists but the page cannot display it     | Inspect `photo` Function logs, row `storage_backend`, expected size/type, Pages CSP, and API responses. Do not add a public R2 domain or browser CORS as a workaround. |
| Cleanup Function works but Cron does not            | Confirm one active `grace-booth-cleanup-expired` job and both named Vault entries. Ensure the Vault cleanup value matches the Function secret.                         |
| Public build contains placeholders or invalid hosts | Set the two `VITE_PUBLIC_*` values, rebuild, inspect `dist/index.html` and `_headers`, then redeploy the new output.                                                   |
| A secret was placed in a Vite variable              | Remove it immediately, rotate the exposed credential, rebuild/redeploy Pages, and investigate cached artifacts and logs. Vite values are public.                       |

### QR delivery or upload fails during operation

Guest capture and local encrypted storage can continue while delivery retries. Check network access, system time, cloud health, the booth enrollment, and **Upload Queue & Retry Buffer**. For the official build, leave custom-project fields blank. Reconnect the dedicated booth account if its session expired.

### Extended display does not open

Choose **Extend these displays**, confirm Windows detects two physical displays before startup, select `Auto` or `Force Enabled` under **Admin > Settings & health > Displays**, and use **Swap Displays** if necessary.

### Logs and failure evidence

Logs are written to:

```text
%APPDATA%\@grace-booth\kiosk\logs\grace-booth.ndjson
```

Report the exact command, full output, application and installer timestamps, Windows version, port occupancy, and sanitized relevant log lines. Never attach the database, encrypted photo directories, secret store, booth credentials, QR tokens, guest images, cookies, signed upload capabilities, or raw filesystem paths to a public issue.

## Security, retention, and incident response

- The renderer is sandboxed and context-isolated and has no direct filesystem, SQLite, or secret access.
- Local guest images use AES-256-GCM; key material is protected by Electron `safeStorage` and Windows DPAPI.
- Booth credentials exist transiently in the Admin form and typed IPC request. The password is cleared after submission; the sealed session remains in Electron main and never enters SQLite.
- Cloud objects remain private in R2 or Supabase Storage and are returned only through token-authorized Function routes.
- QR bearer material stays in the URL fragment and is sent only in strict POST bodies. The public app does not place it in request URLs, browser storage, DOM text, referrers, analytics, or application logs.
- Cloud access stops exactly 720 hours after confirmation. Local guest assets expire after 60 days. Operators cannot change these retention windows.
- LAN administration remains loopback-only unless a specific private interface, trusted certificate, and narrow firewall rule are configured.

If a booth credential, token, guest asset, or encryption key may be exposed:

1. Stop new sessions without deleting local data.
2. Disable the affected `booth_devices` row.
3. Revoke its Supabase Auth sessions and rotate the device credential.
4. Expire affected photo rows and invoke idempotent cleanup.
5. Preserve only sanitized logs and audit records.
6. Determine whether local encrypted media or public bearer links were exposed.
7. Restore service only after the device, credentials, and deployment are verified.

## Related documentation

The root README is the canonical setup, backend deployment, public-page deployment, packaging, and operations guide.

- [`CONTEXT.md`](CONTEXT.md) — canonical frame and session terminology.
- [`docs/SECURITY_AND_RETENTION.md`](docs/SECURITY_AND_RETENTION.md) — detailed trust boundaries, secret handling, retention, and incident response.
- [`docs/SONY_CAMERA_INTEGRATION.md`](docs/SONY_CAMERA_INTEGRATION.md) — native Sony adapter acceptance gate; Sony UVC remains part of the webcam path.
- [`docs/VERIFICATION.md`](docs/VERIFICATION.md) — recorded verification evidence and remaining environment-dependent gates.

# M.A.T. PHOTOBOOTH

M.A.T. Photobooth is an offline-first Windows kiosk for ministry and event photography. It captures three photos with a five-second countdown for each shot, lets the guest review or retake the set, creates the framed photostrip locally, and presents a QR code for download.

The Electron renderer is sandboxed and context-isolated. Local photos are encrypted at rest, operational state is stored in SQLite, image processing runs through Sharp in a worker, and cloud delivery uses a private Supabase-backed workflow.

## Repository layout

- `apps/kiosk` — Electron 43 and React 19 kiosk, local storage, capture workflow, frame editor, QR delivery, and Windows packaging.
- `apps/public` — public React download page for guest photo links.
- `packages/shared` — shared Zod schemas, IPC contracts, and domain types.
- `packages/ui` — `@grace-booth/ui` shared component library powered by Base UI and Tailwind CSS v4 design tokens.
- `supabase` — database migrations, private Storage policies, Edge Functions, and retention jobs.
- `tests/e2e` — Electron and visual Playwright coverage.

## Kiosk requirements

- Windows 10 or Windows 11, x64
- Node.js 24.x
- pnpm 11.x through Corepack
- Git
- A built-in or USB UVC webcam
- Internet access when cloud QR delivery is required
- A display resolution of at least 1280x720

Deno, Docker Desktop, and the Supabase CLI are only required for local backend development. They are not required to install or operate an already packaged kiosk.

## Developer setup from a fresh clone

Run these commands in PowerShell:

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

### Development configuration

The kiosk defaults to the system webcam; select and persist the desired camera from the operator panel. Cloud overrides for development may be placed in a root `.env` file:

```env
GRACE_BOOTH_SUPABASE_URL=https://your-project.supabase.co
GRACE_BOOTH_SUPABASE_PUBLISHABLE_KEY=sb_publishable_REPLACE_ME
```

Set both Supabase values or leave both unset. Never put a Supabase secret/service-role key in the kiosk configuration. The kiosk accepts only a publishable/anon key.

Development builds load local `.env` files. Packaged builds deliberately do not. The official packaged build already contains the production Supabase project URL and publishable key; a kiosk using that project should not set cloud environment variables or enter replacement project values. Environment-variable and operator-panel project overrides are for custom deployments that intentionally use a different Supabase project.

### Start the development kiosk

```powershell
pnpm dev:kiosk
```

Only one development or packaged kiosk should run on a workstation at a time. The application reserves:

- `127.0.0.1:4311` for local operator access.
- `0.0.0.0:4310` for offline photo delivery.

Stop development with `Ctrl+C` in the terminal before starting a packaged build.

## First kiosk configuration

On the first successful launch:

1. Create the required operator passcode. It must contain 8–64 characters. Guest sessions remain locked until this is complete.
2. Open **Admin**, enter the passcode, and select **Settings & Health**.
3. Under **Optical Capture Hardware**, choose **Configure Camera & Test Feed**.
4. Select the built-in/USB webcam and confirm that the preview works.
   The saved device must report at least 1920×1080. For a Sony ILCE-7M4, enable 1080p USB Streaming,
   connect over USB 3/SuperSpeed, and select its UVC webcam entry; native PC Remote is unsupported.
5. Obtain the dedicated booth-account email and password assigned to this laptop by the Supabase project owner. The installer does not need a Supabase Dashboard account.
6. Under **Cloud connection**, leave **Supabase Project URL** and **Supabase Publishable / Anon Key** blank to use the production project embedded in the official build. Enter only the assigned booth-account email and password, then click **Connect cloud**.
7. Never enter a Supabase Dashboard-owner password, `sb_secret_...` key, or legacy `service_role` key in the kiosk.
8. Confirm that camera, database, encrypted storage, and cloud health are reported correctly.
9. Open **Frame Editor** and switch between **Collage 1 · M.A.T.** and **Collage 2 · Anniversary**. Verify that each packaged frame has its own three photo-slot outlines. Replacing artwork or saving slot geometry affects only the active collage; there are no separate layout presets.
10. Save only if you intentionally changed a frame or its slot geometry, return to the booth, and complete one test session.
11. Confirm all three five-second countdowns, both choices on **Choose your collage**, Retake, Processing, the selected final photostrip, QR scanning, download, and **Done** behavior.

LAN admin access is disabled by default. Enable it only on a trusted private network and configure the required TLS certificate first.

## Guest workflow

1. The **Ministry Fair** attract screen starts a new session.
2. The camera takes three photos, each beginning with a five-second countdown.
3. **Choose your collage** previews all three captures in both the M.A.T. and Anniversary frames, using the same slot geometry as the generated result.
4. Select the desired collage. **Retake all photos** restarts the complete sequence; **Use these photos** continues with the selected frame.
5. **Processing** creates the selected collage locally and performs delivery.
6. **All set!** shows the complete photostrip and a scannable QR code.
7. **Done** ends the session and returns to the attract screen.

## Dual-monitor & multi-display setup

Grace Booth supports dual-display operation to separate the interactive capture experience from the public QR delivery screen.

- **Screen 1 (Primary / Guest Viewfinder)**: Displays the Attract loop, interactive countdowns, live camera viewfinder, and collage review stage.
- **Screen 2 (Secondary / QR Delivery Display)**: Dedicated guest-facing display showing the completed photostrip and high-contrast QR code for instant smartphone scanning, freeing up the primary screen for the next group.

### Display configuration options

Open **Admin > Settings & Health > Dual-Monitor Setup**:

1. **Dual Display Mode**:
   - `Auto`: Automatically enables dual-screen mode whenever 2 or more physical displays are detected.
   - `Force Enabled`: Keeps the secondary delivery window active.
   - `Disabled`: Restricts the application to single-monitor operation.
2. **Display Swapping**: Click **Swap Displays** to quickly interchange the primary capture window and secondary delivery window without reconfiguring Windows display settings.
3. **QR Auto-Dismiss Duration**: Set the timer (30s, 45s default, 60s, or 90s) after which the secondary delivery screen automatically clears to protect privacy and prepare for subsequent guest sessions.

## Google Photos live album sync

Grace Booth can automatically upload completed high-resolution photostrips directly to a designated Google Photos shared album in real time.

```text
[ Kiosk Photo Session ]
         │ (Captures 3 photos + builds Photostrip Collage)
         ▼
[ Cloudflare R2 / Supabase Storage ]
         │ (Instant upload & confirmation via confirm-upload)
         ├───────────────────────────────────────────────────────┐
         ▼                                                       ▼
[ Screen 1 / Screen 2 (Dual Monitor) ]             [ google_sync_queue (Supabase) ]
  • Instant Attract Reset for Screen 1                   │ (Non-blocking async trigger)
  • Immediate QR Delivery on Screen 2                    ▼
                                                   [ sync-google-photos (Edge Function) ]
                                                         │ (Streams Collage from R2)
                                                         ▼
                                                   [ Google Photos Shared Album ]
```

### Architecture & Non-Blocking Design
- **Zero Guest Latency**: Captures and QR code delivery on Screen 1 / Screen 2 complete instantly. Guests never wait for Google Photos sync.
- **Asynchronous Resilient Worker**: When a photostrip is confirmed, a database trigger automatically enqueues a sync task in `google_sync_queue`. The `sync-google-photos` Supabase Edge Function streams the image bytes directly from Cloudflare R2 into the designated Google Photos album in the background.
- **Offline & Retry Resilient**: If the internet drops or Google Photos API throttles, jobs remain queued with exponential backoff and retry mechanisms.

---

### Prerequisites & Google Cloud Console Setup

To enable Google Photos integration for your Supabase backend:

1. **Create / Open a Google Cloud Project**:
   - Go to [Google Cloud Console](https://console.cloud.google.com/).
   - Create a new project (e.g. `Grace Booth Photobooth`) or select an existing one.
2. **Enable Google Photos Library API**:
   - Navigate to **APIs & Services > Library**.
   - Search for **Photos Library API** and click **Enable**.
3. **Configure OAuth Consent Screen**:
   - Go to **APIs & Services > OAuth consent screen**.
   - Select **External** (or Internal for Google Workspace).
   - Fill in App Name (e.g., `M.A.T. Photobooth`), Support Email, and Developer Contact Info.
   - Add scopes: `https://www.googleapis.com/auth/photoslibrary.appendonly` and `https://www.googleapis.com/auth/photoslibrary.sharing`.
   - Add test users (if published in Testing mode) including the event organizer's Google Account.
4. **Create OAuth 2.0 Credentials**:
   - Go to **APIs & Services > Credentials > Create Credentials > OAuth client ID**.
   - Application type: **Web application**.
   - Name: `Photobooth Backend Auth`.
   - **Authorized redirect URIs**: Add your Supabase Edge Function redirect URL:
     ```text
     https://<YOUR_SUPABASE_PROJECT_REF>.supabase.co/functions/v1/google-photos-auth
     ```
   - Save and copy the generated **Client ID** and **Client Secret**.
5. **Set Supabase Edge Function Secrets**:
   - Set the secrets in your Supabase project (via CLI or Supabase Dashboard > Project Settings > Edge Functions):
     ```powershell
     npx supabase secrets set GOOGLE_CLIENT_ID="your_google_client_id.apps.googleusercontent.com" GOOGLE_CLIENT_SECRET="your_google_client_secret" --project-ref <YOUR_SUPABASE_PROJECT_REF>
     ```

---

### Kiosk Operator Step-by-Step Configuration

1. **Open Operator Settings**:
   - In the Kiosk, open **Admin** (enter your operator passcode) and navigate to **Settings & Telemetry > Google Photos**.
2. **Enable Live Sync**:
   - Toggle **Enable Google Photos Live Sync** to `ON`.
3. **Authorize Google Account**:
   - Click **Authorize Google Account** (or **Re-Authorize**).
   - A browser window will open asking you to sign in with your event's Google account and grant Photos permissions.
   - After completing the consent prompt, return to the Kiosk and click **Check Auth Status**.
   - Confirm your connected Google email is displayed with a green verified checkmark.
4. **Create or Select Event Album**:
   > [!IMPORTANT]
   > **Google Photos API Policy Constraint**: The Google Photos Library API strictly requires that photos added to an album be added to an album **created by the same application via the API** (`albums.create`). Albums manually created on the consumer Google Photos web app cannot receive programmatic uploads.
   - In the **Create new shared event album (Recommended)** field, type your event title (e.g. `Ministry Fair 2026`, `Youth Camp 2026`).
   - Click **Create & Select**.
   - The application creates the album, enables public link sharing, saves it as the active live sync target, and displays the **Active Target Album** banner with a shareable URL.
5. **Share the Live Album with Guests & Organizers**:
   - Click **Copy Guest Album Link** to copy the public album URL to your clipboard.
   - Click **Open in Browser** to view live streaming photos in real time.
6. **Diagnostics & Manual Controls**:
   - **Send Test Photo**: Click to verify immediate end-to-end cloud upload and Google Photos album delivery.
   - **Sync Pending Now**: Manually trigger queue processing for any buffered jobs.
   - **Telemetry Cards**: Monitor `Synced Strips`, `Pending`, and `Failed` sync metrics directly from the operator dashboard.

## Build and package the Windows kiosk

### 1. Stop every kiosk instance

Close the installed app and stop `pnpm dev:kiosk` with `Ctrl+C`. Do not package while `Grace Booth.exe` or the development Electron kiosk is running.

Confirm the two kiosk ports are free:

```powershell
Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
  Where-Object { $_.LocalPort -in 4310, 4311 } |
  Select-Object LocalAddress, LocalPort, OwningProcess
```

No rows should be returned.

### 2. Restore the locked dependencies

```powershell
pnpm install --frozen-lockfile
```

### 3. Run the source checks

```powershell
pnpm --filter @grace-booth/kiosk typecheck
pnpm --filter @grace-booth/kiosk test
pnpm --filter @grace-booth/kiosk build
```

### 4. Create the installer

From the repository root:

```powershell
pnpm dist:win
```

This command performs the kiosk production build, packages Electron for Windows x64, creates an NSIS installer, and runs the packaged native-module self-test.

A successful self-test ends with output similar to:

```json
{ "ok": true, "sqlite": true, "sharp": true, "worker": true, "safeStorage": true }
```

Build outputs:

- Installer: `apps/kiosk/release/Grace-Booth-<version>-x64-setup.exe`
- Unpacked application: `apps/kiosk/release/win-unpacked/Grace Booth.exe`

The Sharp messages about Darwin, Linux, ARM, or musl optional packages are cross-platform packaging notices. They are not a Windows x64 failure when the final packaged native self-test passes.

### 5. Verify packaged startup

After `pnpm dist:win` succeeds, run the packaged startup smoke test on the build computer:

```powershell
pnpm --filter @grace-booth/kiosk startup:smoke:packaged
```

The test launches `release/win-unpacked/Grace Booth.exe` with an isolated temporary profile, completes the first-run passcode screen when needed, verifies that the **Ministry Fair** attract screen remains healthy, writes `test-results/packaged-attract.png`, and closes the verification instance. It does not alter the normal kiosk profile under `%APPDATA%`.

## Install and start the packaged app

1. Copy `Grace-Booth-<version>-x64-setup.exe` to the kiosk computer.
2. Stop any running development kiosk or older Grace Booth process.
3. Run the installer and complete the per-user installation wizard.
4. Start **Grace Booth** from the desktop or Start menu shortcut.
5. Complete the first kiosk configuration above if this is a new Windows user profile.
6. Run a complete three-photo test session before opening the booth to guests.

Normal application data is stored under:

```text
%APPDATA%\@grace-booth\kiosk
```

This directory contains the SQLite database, encrypted photo assets, protected secrets, frame data, staging data, and logs. Do not delete it as a general troubleshooting step. Deleting it can remove local booth state and photos.

## Cloud delivery setup

All official kiosk installations use the same embedded Supabase project, database, and private photo Storage. Installing the application on another laptop does not create another Supabase project.

### Responsibilities

The Supabase project owner:

1. Maintains the shared Supabase project and backend resources listed below.
2. Creates a dedicated Supabase Auth booth user under **Authentication > Users**. This is an application user, not a Supabase Dashboard administrator.
3. Enrolls that Auth user's ID in the project's `booth_devices` table.
4. Supplies the assigned booth email and password securely to the person configuring the laptop.

The installer/operator:

1. Does not create a personal Supabase account and does not need Supabase Dashboard access.
2. Leaves the project URL and publishable-key fields blank when installing the official build.
3. Enters the assigned booth email and password once. The resulting session is protected locally by Windows DPAPI.

For a custom deployment using a different Supabase project, the project owner—not the installer—gets the project URL from the project's **Connect** dialog and the `sb_publishable_...` key from **Settings > API Keys**. The owner may then supply those two non-secret client values with the booth credentials. See the official [Supabase API-key documentation](https://supabase.com/docs/guides/getting-started/api-keys) and [Auth user documentation](https://supabase.com/docs/guides/auth/users).

Never distribute or enter a Supabase secret/service-role key in a desktop application. A production backend requires:

- The repository Supabase migrations applied to the project, including the repair ledger and guarded repair/rollback RPCs.
- A private `photos` Storage bucket accepting JPEG files.
- The `create-upload`, `confirm-upload`, `photo`, `repair-photo`, and `cleanup-expired` Edge Functions deployed.
- Function secrets for `PUBLIC_TOKEN_DERIVATION_KEY`, `PUBLIC_PAGE_ORIGIN`, `PHOTO_BUCKET`, and `CLEANUP_SECRET`.
- Private R2 Function secrets (`R2_ACCOUNT_ID`, access key, secret key, and bucket name). R2 remains
  server-only; the browser does not require bucket CORS access.
- A dedicated confirmed Supabase Auth user enrolled in `booth_devices`.
- The public download application deployed at the same `PUBLIC_PAGE_ORIGIN` used by the functions.

For backend development and deployment details, see [`supabase/README.md`](supabase/README.md).

## Verification commands

Kiosk-only checks:

```powershell
pnpm --filter @grace-booth/kiosk typecheck
pnpm --filter @grace-booth/kiosk test
pnpm --filter @grace-booth/kiosk build
pnpm native:self-test
pnpm native:self-test:packaged
pnpm --filter @grace-booth/kiosk startup:smoke:packaged
```

Repository-wide checks:

```powershell
pnpm typecheck
pnpm test
pnpm lint
pnpm format:check
pnpm test:e2e
```

`native:self-test:packaged` and `startup:smoke:packaged` require an existing `apps/kiosk/release/win-unpacked` package. Run `pnpm dist:win` first when it does not exist or is stale.

## Troubleshooting

### “Grace Booth could not start”

The safety dialog intentionally does not expose internal details. Common causes include another kiosk process using port 4310 or 4311, incomplete packaged native modules, missing packaged resources, or damaged local configuration.

1. Close Grace Booth if it is already open.
2. Stop any `pnpm dev:kiosk` terminal with `Ctrl+C`.
3. Check the ports:

   ```powershell
   Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
     Where-Object { $_.LocalPort -in 4310, 4311 } |
     Select-Object LocalAddress, LocalPort, OwningProcess
   ```

4. Identify a returned process before stopping it:

   ```powershell
   Get-CimInstance Win32_Process -Filter "ProcessId = <PID>" |
     Select-Object ProcessId, Name, ExecutablePath, CommandLine
   ```

5. If and only if it is a stale Grace Booth/Electron development process, stop that exact PID:

   ```powershell
   Stop-Process -Id <PID>
   ```

6. Start Grace Booth again. Reboot Windows if the verified stale process cannot be closed normally.

On the build computer, test the package itself before copying the installer to another laptop:

```powershell
pnpm native:self-test:packaged
pnpm --filter @grace-booth/kiosk startup:smoke:packaged
```

If the native self-test fails, rebuild the package as described below. If both checks pass and the installed copy still fails, inspect the newest log under `%APPDATA%\@grace-booth\kiosk\logs` before changing the local configuration.

Do not delete `%APPDATA%\@grace-booth\kiosk` to resolve this error.

### The installer is older than the source changes

`pnpm --filter @grace-booth/kiosk build` creates compiled files only; it does not refresh the installer. Run:

```powershell
pnpm dist:win
Get-Item 'apps/kiosk/release/Grace-Booth-*-x64-setup.exe' |
  Select-Object Name, Length, LastWriteTime
```

Install the newly timestamped artifact.

### Packaged native self-test fails

1. Stop all kiosk instances.
2. Confirm Node 24 and pnpm 11.
3. Restore dependencies and package again:

   ```powershell
   pnpm install --frozen-lockfile
   pnpm dist:win
   ```

4. Use the final JSON result—not the cross-platform Sharp notices—to determine success.

### `Error: Electron uninstall` during development

Electron's binary download was skipped, interrupted, or blocked. Repair it with:

```powershell
pnpm rebuild electron
pnpm dev:kiosk
```

If dependencies are incomplete:

```powershell
pnpm install --force
```

On a network that blocks GitHub release downloads, configure an approved Electron mirror before rebuilding.

### Camera preview is blank or capture fails

1. Close other programs using the webcam.
2. In Windows **Privacy & security > Camera**, allow camera access and desktop-app access.
3. Open **Admin > Settings & Health > Configure Camera & Test Feed**.
4. Select the intended device and confirm its preview.
5. Confirm the modal reports at least **1920 × 1080**; saving is blocked below that resolution.
6. For the Sony ILCE-7M4, use **1080p USB Streaming** over USB 3/SuperSpeed and select the Sony UVC
   device. Do not select the unsupported native Sony PC Remote adapter.
7. Disconnect/reconnect the USB camera or restart the kiosk if the device list is stale.

### QR delivery or upload fails

1. Guest capture and local encrypted storage can continue while delivery retries.
2. Check network access and system time.
3. Open **Admin > Settings & Health** and review cloud health.
4. For the official build, confirm the project URL and publishable-key fields were left blank unless the project owner explicitly supplied a custom-project pair.
5. Confirm the assigned booth user is active and enrolled in `booth_devices`.
6. Reconnect the dedicated booth account if its session expired.
7. Inspect **Upload Queue & Retry Buffer** and retry failed jobs after connectivity returns.

### Logs and failure evidence

Application logs are written to:

```text
%APPDATA%\@grace-booth\kiosk\logs\grace-booth.ndjson
```

When reporting a failure, include:

- The exact command used.
- The full terminal output from that command.
- The app and installer timestamps.
- The Windows version.
- Whether ports 4310/4311 were occupied.
- The latest relevant log lines, after checking that they contain no private event data.

Never attach the database, encrypted photo directories, `secrets` directory, booth credentials, QR tokens, or guest images to a public issue.

## Security and data handling

- The renderer is sandboxed, context-isolated, and has no direct filesystem/database access.
- Local guest images are encrypted with AES-256-GCM; key material is protected by Electron `safeStorage`/Windows DPAPI.
- Cloud photos are stored in a private bucket and retrieved through time-limited delivery flows.
- QR links use URL fragments so bearer material is not sent in normal HTTP request headers.
- Cloud and local retention windows are enforced by their respective cleanup services.

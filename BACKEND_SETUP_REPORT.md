# Grace Booth - Supabase Cloud Backend Setup Report

This document details the backend setup completed for **Grace Booth** via the **Supabase MCP Server**, according to **Path 2: Full Supabase Cloud Backend Setup** from [`SETUP.md`](./SETUP.md).

---

## 1. Summary of Completed Setup Steps

| Step       | Component                        |    Status     | Details                                                                                                                                                            |
| :--------- | :------------------------------- | :-----------: | :----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Step 1** | **Supabase Project Discovery**   | **COMPLETED** | Connected to project `Lumio Photobooth` (`bejgkclvsfbkpkflftxu`) in region `ap-northeast-1` (Tokyo).                                                               |
| **Step 2** | **Database Schema & Migrations** | **COMPLETED** | Applied all 3 core SQL migrations: `booth_devices`, `photo_sessions`, RLS policies, RPC functions, and `pg_cron` schedule.                                         |
| **Step 3** | **Private Storage Bucket**       | **COMPLETED** | Materialized the private, JPEG-only legacy `photos` bucket. New production uploads use private R2 and the application no longer imposes a fixed JPEG byte ceiling. |
| **Step 4** | **Vault Secrets Configuration**  | **COMPLETED** | Stored encrypted `grace_booth_project_url` and `grace_booth_cleanup_secret` in Supabase Vault for automatic daily cron cleanup.                                    |
| **Step 5** | **Booth Auth Device Enrollment** | **COMPLETED** | Created dedicated booth account `booth1@gracebooth.local` and enrolled its UUID in `public.booth_devices`.                                                         |
| **Step 6** | **Edge Functions Deployment**    | **COMPLETED** | Deployed and activated all 4 Edge Functions: `create-upload`, `confirm-upload`, `photo`, and `cleanup-expired`.                                                    |

---

## 2. Key Database & Project Credentials

Below are the important credentials configured for your backend:

### Project API Configuration

- **Supabase Project ID (Ref)**: `bejgkclvsfbkpkflftxu`
- **Project API URL**: `https://bejgkclvsfbkpkflftxu.supabase.co`
- **Publishable Key (Modern)**:
  ```text
  sb_publishable_kOTsRWT42YKfBIfxTW2eHA_vPjE9j4O
  ```
- **Anon Key (Legacy JWT)**:
  ```text
  eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJlamdrY2x2c2Zia3BrZmxmdHh1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcwNDU5MzgsImV4cCI6MjEwMjYyMTkzOH0.wfkfjEFL5KFA6WMkCBdMZdMDE9DyUz1n_MGgynu9fD4
  ```

---

### Booth Operator Account (Enrolled Device)

- **User UUID**: `090a63a3-042d-4b87-96c8-8533a402edcc`
- **Booth Device Name**: `Main Booth 1`
- **Status**: `enabled: true`
- **Login Email**: `booth1@gracebooth.local`
- **Login Password**: `GraceBooth2026!Secure`

---

### Security & Token Secrets (Pre-configured in Edge Functions & Vault)

- **Public Token Derivation Key**:
  ```text
  f/8V8Ds3S1WO2vjz9GN9KWdWunk3GnSybtCEHUOs4jk=
  ```
- **Cleanup Secret**:
  ```text
  98a19a1472c787f864372a79312275bbd6197c623232341c42541f838f2041c7
  ```
- **Public Page Origin**: `http://127.0.0.1:4173` _(default for local testing; change to production domain when deploying public site)_
- **Photo Storage Bucket**: `photos` (Private)

---

## 3. Active Edge Functions

All 4 Edge Functions are live on your Supabase project:

1. **`create-upload`**
   - **URL**: `https://bejgkclvsfbkpkflftxu.supabase.co/functions/v1/create-upload`
   - **JWT Required**: `true` (Requires authenticated booth JWT)
   - **Role**: Validates booth enrollment, rate limits, derives public HMAC tokens, and issues signed upload URLs.
2. **`confirm-upload`**
   - **URL**: `https://bejgkclvsfbkpkflftxu.supabase.co/functions/v1/confirm-upload`
   - **JWT Required**: `true` (Requires authenticated booth JWT)
   - **Role**: Verifies uploaded JPEG dimensions/hash and finalizes photo session into `ready` state with 720-hour expiry.
3. **`photo`**
   - **URL**: `https://bejgkclvsfbkpkflftxu.supabase.co/functions/v1/photo`
   - **JWT Required**: `false` (Public bearer token in POST body)
   - **Subroutes**: `/photo/resolve`, `/photo/image`, `/photo/download`
4. **`cleanup-expired`**
   - **URL**: `https://bejgkclvsfbkpkflftxu.supabase.co/functions/v1/cleanup-expired`
   - **JWT Required**: `false` (Authenticated via `X-Cleanup-Secret` header from Postgres cron)
   - **Role**: Leases and purges expired photos from Storage and updates session status to `deleted`.

---

## 4. Next Step: How to Launch & Connect Grace Booth

Now that the backend is completely set up, you can run the kiosk and connect to your live Supabase backend:

### Step 1: Launch Kiosk with Supabase URL & Key

In PowerShell, run:

```powershell
$env:GRACE_BOOTH_SUPABASE_URL = "https://bejgkclvsfbkpkflftxu.supabase.co"
$env:GRACE_BOOTH_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_kOTsRWT42YKfBIfxTW2eHA_vPjE9j4O"
pnpm dev:kiosk
```

### Step 2: Set Operator Passcode & Sign into Cloud in the App

1. When Grace Booth launches, enter a local operator passcode (e.g. `admin12345`).
2. On the Attract / Home screen, click the **Gear (⚙️) icon** in the top right to open **Admin Settings**.
3. Under **Cloud Connection**:
   - **Email**: `booth1@gracebooth.local`
   - **Password**: `GraceBooth2026!Secure`
   - Click **Connect / Sign In**.
4. Click **Save / Return to Booth**.

### Step 3: Test Guest Capture & QR Retrieval

1. Click **Start Session**, smile, and take 4 photos with your webcam.
2. Review the photos and click **Use these photos**.
3. The booth will assemble the collage, upload it to your Supabase `photos` bucket, confirm the session, and display the verified QR Code on the **Final Screen**!

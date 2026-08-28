# Grace Booth MVP verification record

Verified on 2026-08-18 (Asia/Manila) on the implementation workstation.

## Workstation

- Windows 10 Home Single Language x64, version 10.0.19045, build 19045.
- Node.js 24.14.0.
- pnpm 11.19.0.
- Git 2.53.0.windows.1.
- Docker and Podman are not installed.

This host is suitable for implementation and unsigned package verification, but Windows 10 build 19045 is past standard support. Production booth use requires Windows 11 or active Windows 10 ESU coverage.

## Completed checks

| Check                            | Result | Coverage                                                                                                                           |
| -------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile` | Pass   | Checked-in pnpm dependency graph.                                                                                                  |
| `pnpm format:check`              | Pass   | Prettier workspace files and Deno Function formatting.                                                                             |
| `pnpm lint`                      | Pass   | Strict ESLint workspace rules and Deno lint.                                                                                       |
| `pnpm typecheck`                 | Pass   | Root Playwright, all workspace packages, kiosk main/preload/renderer, and all Function/integration sources.                        |
| `pnpm test`                      | Pass   | 95 tests: shared 4, public 9, kiosk 68, Edge Function helpers 14.                                                                  |
| `pnpm build`                     | Pass   | Kiosk, public page, and shared package. With no hosted configuration, the public build is intentionally inert at `.invalid`.       |
| `pnpm test:e2e`                  | Pass   | 33 Playwright tests across the public page, 22 locked visual states plus reduced motion, and 7 real Electron journeys.             |
| `pnpm native:self-test`          | Pass   | Development Electron: better-sqlite3, Sharp, long-lived image worker, and `safeStorage`.                                           |
| `pnpm dist:win`                  | Pass   | Unsigned Windows x64 NSIS package, ASAR/unpacked native modules, hardened Electron fuses, and automatic packaged native self-test. |
| `pnpm native:self-test:packaged` | Pass   | `win-unpacked/Grace Booth.exe --native-self-test`: better-sqlite3, Sharp, worker, and `safeStorage` all true.                      |
| `pnpm test:supabase:integration` | Gated  | Source checked; 0 passed, 0 failed, 1 ignored because the explicit local flag and container stack were absent.                     |

The Electron acceptance project covers:

- First-run passcode bootstrap and re-locking after bootstrap.
- Happy-path capture, two full retake rounds, confirmation-gated QR display, restoration after a simulated time advance beyond ten minutes, Done reset, and Start focus.
- Four production-length eight-second countdowns, measured at no less than 31.5 seconds total.
- Camera failure with passcode-gated operator restart.
- Initial upload plus exact 1, 3, and 8 second automatic retries, exhausted recovery, and a successful manual retry cycle.
- Immediate process exit and durable recovery during create, signed upload, and confirmation phases.

The visual project checks 11 canonical states at both 1366 x 768 and 1280 x 720. All 22 baselines use fixed data, fonts, DPR 1, and disabled animation/caret. Each state asserts no body overflow, no third-party renderer requests, and no Axe serious or critical violations. The additional reduced-motion test verifies that cosmetic rotation and shutter flash are removed without altering capture timing.

The checked-in pgTAP suite contains 60 assertions. The checked-in local Function integration suite covers allow-listing, ownership, direct-access denial, concurrent idempotency, signed upload, validation, atomic confirmation, exact expiry, exact CORS and routes, controlled streaming, expired-token equivalence, and repeated cleanup. Both sources pass static checking.

## Deploy order

The QR photo-delivery chain only works when hosted artifacts come from the same tree and are applied in this order:

1. Apply the checked-in Supabase migrations (`supabase db push`) so `resolve_photo_session` returns `storage_backend`.
2. Deploy the Edge Functions from that same tree.
3. Build and deploy the public page from that same tree with `VITE_PUBLIC_PHOTO_API_URL` and `VITE_PUBLIC_PAGE_ORIGIN` set.
4. Run the hosted smoke test (`pnpm smoke:photo` with a valid token); it verifies storage-aware resolution plus direct API JPEG bytes for image and download without exposing R2 URLs.

## Windows artifact

- Installer: `apps/kiosk/release/Grace-Booth-0.1.0-x64-setup.exe`
- Installer size: 133,341,830 bytes.
- Installer SHA-256: `CEB7A9554FC22B8231AA2C89A25BF6E9333492081ADCB80EC5E7D8390E8FA303`.
- Block map: `apps/kiosk/release/Grace-Booth-0.1.0-x64-setup.exe.blockmap` (139,613 bytes).
- Unpacked executable: `apps/kiosk/release/win-unpacked/Grace Booth.exe` (225,533,440 bytes).

The packaged executable reports these fuses:

- Run as Node: disabled.
- Cookie encryption: enabled.
- Node options environment variable: disabled.
- Node CLI inspect arguments: disabled.
- Embedded ASAR integrity validation: enabled.
- Only load application from ASAR: enabled.
- Extra `file://` protocol privileges: disabled.

The installer is unsigned and is for internal verification only. Production release requires an Authenticode certificate and signing-workflow decision.

## Intentionally blocked or not authorized

- Supabase local database reset, the 60 pgTAP assertions, and the live local Edge Function suite were not executed because Docker Desktop and Podman are unavailable. No substitute hosted target was used.
- Supabase project creation, migration push, Function deployment, Storage provisioning, Vault/Cron materialization, Cloudflare Pages deployment, DNS, and production origins were not authorized and were not changed.
- Hosted-origin/CORS smoke tests remain blocked until approved Supabase and Cloudflare Pages resources exist.
- Real Sony capture remains blocked pending the exact camera body, firmware, official SDK evidence and redistribution approval, and physical acceptance/soak tests.
- Authenticode signing and installed/uninstall validation on a clean supported Windows 11 account remain release-operations tasks.

## Controlling brief integrity

`CODEX_BUILD_PROMPT.md` was preserved unchanged. Its final SHA-256 is:

`0ED374E20E334172092BCE694B61120F5B8164DCE93DD8A36762F29F8D48B1CB`

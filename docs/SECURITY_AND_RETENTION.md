# Security and retention operations

## Security boundary

Grace Booth treats Electron main as the only trusted application process. The renderer is sandboxed and receives a fixed, schema-validated preload API. It never receives filesystem paths, database handles, Electron primitives, Supabase credentials, raw public tokens, public URLs, signed upload authorization, or technical exception text.

The main process owns session timing, state transitions, camera calls, image processing, persistence, upload retries, QR generation, authentication, and cleanup. Every IPC request is validated against a strict shared schema and accepted only from the kiosk's top-level `app://grace-booth` frame. Navigation, new windows, webviews, and unapproved protocols are denied, as is every browser permission except the one described below.

## Camera capture on the webcam adapter

A laptop or system camera can only be opened by a renderer, so the default `webcam` adapter splits the work without moving authority out of main. Main decides when a photo is taken: it issues a `booth:camera-frame-requested` event carrying a main-generated capture id and a deadline, and the guest renderer answers on the single `booth:submit-camera-frame` channel with a base64 JPEG. Main accepts a frame only for the capture id it is currently waiting on, allows one request in flight, enforces its own timeout, and revalidates the JPEG signature and size ceiling before the bytes enter the normal encryption and processing path. Late, duplicate, unrequested, or non-JPEG submissions are rejected, and no device identifier, path, or vendor string crosses the preload boundary in either direction.

Two boundary settings support this and nothing more. The session permission handlers grant `media` only when the requesting origin is exactly the kiosk's own `app://grace-booth` origin and the request is video-only; audio, mixed audio/video, every other permission, and every other origin are refused, and `setDevicePermissionHandler` continues to deny HID, serial, and USB devices outright. The renderer CSP adds `blob:` and `mediastream:` to `media-src` so the `<video>` viewfinder can bind the local stream; no other directive changes.

Every webcam request carries 1920×1080 minimum and ideal constraints. A selected device always uses
its exact device id; retries, track-end recovery, and device-list changes never switch to another
camera. Guest Start performs a fresh 15-second resolution preflight before creating a booth
session, preserves the compliant stream into countdown/capture, and releases all tracks on every
idle, review, final, cancellation, failure, modal-close, and unmount path. Mock and visual fixtures
bypass physical capture. The native Sony PC Remote adapter remains visibly unsupported; the
ILCE-7M4 must appear as a UVC webcam in 1080p USB Streaming mode over USB 3/SuperSpeed.

Static application resources use `app://grace-booth`. Decrypted session media is resolved by an opaque identifier through `grace-booth-media://asset/<opaque-id>`, served with an exact content type, `Cache-Control: no-store`, and `X-Content-Type-Options: nosniff`. Session media is never intentionally exposed through `file://`.

## Local secrets and guest media

Windows Data Protection through Electron `safeStorage` seals small application secrets:

- The random installation data-encryption key.
- Booth authentication state.
- Each one-time public token after `create-upload` returns it.
- Optional LAN TLS passphrases.

Guest originals, previews, and collages are encrypted independently with AES-256-GCM. Every encrypted file uses a fresh 96-bit nonce, a versioned authenticated header, and stable asset metadata as additional authenticated data. Files are written to a unique temporary file in the destination directory, flushed, closed, and atomically renamed before the database marks them ready.

If the wrapped installation key cannot be decrypted, the application must stop guest capture and preserve existing files. It must never generate a replacement key over existing encrypted data. `safeStorage` protects secrets for the current Windows user and machine; it is not a substitute for Windows device encryption, a locked operator account, or physical booth security.

## Operator passcode

There is no default passcode. The first local launch requires an operator to create an 8-64 character passcode before guest operation is enabled. Passcodes are derived with built-in `scrypt` using a 32-byte random salt, a 64-byte output, `N=131072`, `r=8`, and `p=1`. Verification is serialized and uses a timing-safe comparison.

Failed authentication is rate-limited and returns one generic result. Changing the passcode verifies the current value, stores a new salted record atomically, writes an audit event, and revokes active admin sessions. Passcodes and derived values are never logged.

## Local and LAN administration

Local administration is available through authenticated kiosk IPC and a loopback-only Fastify listener. The listener binds to `127.0.0.1`, rejects non-loopback sockets, validates Host and Origin, limits request bodies, and does not log request bodies.

LAN access is disabled by default. Enabling it requires all of the following:

- An explicitly selected RFC1918 private interface, never a wildcard bind.
- An operator-supplied HTTPS PFX whose certificate identity matches the private hostname or IP.
- A `safeStorage`-sealed PFX passphrase.
- A manually scoped Windows Firewall rule for Private networks only.

If the interface or certificate becomes invalid, Grace Booth retains loopback access and does not downgrade the LAN listener to plaintext HTTP. Remote bootstrap is not available. LAN sessions use server-side random cookies with `Secure`, `HttpOnly`, `SameSite=Strict`, 15-minute idle expiry, eight-hour absolute expiry, exact-origin checks, and a per-session CSRF value for mutations.

## Cloud identity and public delivery

Electron uses only the Supabase project URL, publishable key, and a dedicated booth user credential. The booth user must appear as enabled in `booth_devices`. It receives no direct table or Storage policy. Edge Functions use the server secret to enforce booth ownership and operate the private `photos` bucket.

Every photo session records its storage backend. Existing rows default to `supabase`; newly created
rows use `r2` when all four private R2 settings are present. Confirmation, public delivery, resume,
and cleanup follow the recorded backend, so enabling R2 cannot orphan legacy Supabase objects. A
partial R2 configuration fails closed instead of silently changing providers.

`create-upload` derives a stable 32-byte base64url bearer token from the booth owner and client-session idempotency key using a server-only, domain-separated HMAC-SHA256 key. This makes concurrent and lost-response retries return the same secret without storing it in plaintext. Postgres stores only the token's SHA-256 hash. Electron seals the raw token immediately, before uploading. The two-hour signed upload authorization remains in memory only. `confirm-upload` rechecks ownership, token hash, cleanup state, JPEG bytes, dimensions, type, size, and SHA-256 before it creates an immutable ready timestamp and exact 720-hour expiry.

The derivation key is independent of the cleanup and Supabase server keys. Routine rotation is allowed only after pending sessions and booth queues are reconciled; incident rotation must explicitly account for pending uploads. Existing ready links remain governed by their stored hashes and exact expiries.

The QR target is `https://<approved-public-origin>/photo#<token>`. URL fragments do not reach Cloudflare Pages or Supabase request paths. The public page sends the token only in strict POST bodies to `/photo/resolve`, `/photo/image`, and `/photo/download`. The application, page, and Functions never log those bodies. Unknown, expired, and deleted tokens receive the same public response shape; malformed requests fail validation before lookup.

For private delivery, resolve and image/download verify the object in the backend recorded on the
row, validate size and JPEG metadata, then recheck token authorization. Image/download return bytes
through the Edge Function; the browser rejects redirects and non-API response origins and renders a
blob URL. R2 URLs, credentials, authorization headers, tokens, and object paths are never placed in
browser state, storage, analytics, logs, or DOM text. The public CSP therefore lists only the exact
Supabase photo API in `connect-src`; no browser-facing R2 CORS rule is needed.

The bearer token grants access to one photo until its exact expiry. Anyone who receives the QR or copied URL can use it during that period. The public page therefore uses `no-store`, a restrictive CSP, no analytics, no third-party renderer requests, no referrer leakage, and no token in paths or query strings.

## Log handling

Application logs use structured allowlisted fields and redact case-insensitive keys for authorization, cookies, passcodes, tokens, URLs, filesystem paths, request bodies, Supabase sessions, signed upload authorization, encryption material, and image bytes. Guest UI receives only stable sanitized reason codes and calm copy.

Audit records cover operator actions such as passcode, frame, settings, retry, and LAN changes. They contain timestamps, action types, and sanitized outcomes only. They do not contain guest images, raw tokens, public URLs, credentials, or arbitrary request payloads.

## Fixed retention

Retention is fixed and is not an editable setting:

- Cloud access ends at `ready_at + 720 hours`, exactly 30 days.
- Cloud cleanup removes expired ready objects and stale pending objects in idempotent batches. Cleanup timing never extends public access because every public request checks `expires_at > now()` before streaming bytes.
- Local originals, prior retake rounds, previews, and collages expire 60 days after their retention anchor.
- Local cleanup uses tombstones so interrupted deletion resumes safely. It cancels remaining upload work, removes encrypted assets, and retains count-only audit evidence.

Retake-all never deletes the previous round immediately. Upload failure never discards the local collage. Recovery preserves valid review, processing, queued upload, and final work.

## Production prerequisites

The unsigned installer is for internal verification. Production deployment requires a Windows code-signing decision, trusted TLS material for any LAN listener, a provisioned Supabase project and Cloudflare Pages site, a dedicated allowlisted booth identity, and an approved public origin.

This development host runs Windows 10 build 19045, which is past standard support. A production booth must use Windows 11 or an actively supported Windows 10 ESU installation. Real Sony capture also remains disabled until the separate hardware gate in `SONY_CAMERA_INTEGRATION.md` passes.

## Incident response

If guest media, a public token, a booth credential, or an encryption key may have been exposed:

1. Stop new sessions without deleting local data.
2. Disable the booth identity in `booth_devices`.
3. Revoke its Supabase Auth sessions and rotate the device credential.
4. Expire affected cloud rows and run the idempotent cleanup function.
5. Preserve sanitized audit and application logs.
6. Determine whether local encrypted assets or only public bearer links were exposed.
7. Restore operation only after the credential, device, and deployment configuration are verified.

Never paste raw guest tokens, credentials, paths, or image bytes into support tickets or shared logs.

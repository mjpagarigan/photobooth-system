# Grace Booth public photo page

This package is the static Vite application deployed to Cloudflare Pages for the guest-facing
`/photo#<token>` URL. The raw 256-bit token stays in the fragment and is sent only in strict JSON
bodies to the three Supabase Function POST routes:

- `/photo/resolve`
- `/photo/image`
- `/photo/download`

The page does not put the token in a request URL, browser storage, DOM text, referrers, analytics,
or application logs. Authenticated image/download POST requests return JPEG bytes directly from the
photo Function after it verifies the recorded storage object and reauthorizes the token. Redirects
and non-API response origins are rejected. The browser exposes only a blob URL to the DOM.

## Required Cloudflare Pages build configuration

Configure the Pages project to build from the repository root:

```text
Build command: pnpm build
Build output directory: apps/public/dist
```

Set both production build variables:

```text
VITE_PUBLIC_PHOTO_API_URL=https://<project-ref>.supabase.co/functions/v1/photo
VITE_PUBLIC_PAGE_ORIGIN=https://<production-photo-domain>
```

`VITE_PUBLIC_PAGE_ORIGIN` must be the exact Cloudflare Pages production or custom-domain origin.
Supabase must receive the same value as its server-only `PUBLIC_PAGE_ORIGIN` secret. Preview origins
intentionally cannot call the photo API.

The Vite production build validates these values and emits Cloudflare Pages `_headers` and
`_redirects` files into `dist`. The response CSP permits connections only to the exact Supabase API
origin. `/photo` remains non-cacheable and unindexed, while hashed assets receive immutable
caching. The checked-in `wrangler.jsonc` provides the equivalent SPA fallback when deploying the
same output through Wrangler static assets.

## Local verification

```powershell
pnpm typecheck
pnpm test
$env:VITE_PUBLIC_PHOTO_API_URL = 'http://127.0.0.1:54321/functions/v1/photo'
$env:VITE_PUBLIC_PAGE_ORIGIN = 'http://127.0.0.1:4173'
pnpm build
```

## Cloudflare Workers & Pages
## 1. Set the build-time env vars

```powershell
$env:VITE_PUBLIC_PHOTO_API_URL = 'https://<project-ref>.supabase.co/functions/v1/photo'
$env:VITE_PUBLIC_PAGE_ORIGIN = 'https://photos.example.org'
```

`VITE_PUBLIC_PAGE_ORIGIN` must be an exact origin — no path, no trailing slash — and it must be the **same value** you'll set as the `PUBLIC_PAGE_ORIGIN` secret on the Supabase Edge Functions (that's what the CORS/origin check compares against).

## 2. Build

From the repo root:
```powershell
pnpm build
```
This runs `@grace-booth/public`'s build and writes to `apps/public/dist`.

Sanity-check the output before deploying:
```powershell
Select-String -Path apps/public/dist/index.html -Pattern "__PHOTO_API_ORIGIN__|unconfigured.invalid"
```
No matches means it's a real, configured build. The build also emits `dist/_headers` (exact CSP including the API origin) and `dist/_redirects`; review both before deploying.

## 3. Deploy with Wrangler (matches the checked-in config)

`wrangler.jsonc` already declares a static-assets Worker serving `apps/public/dist` — this is Cloudflare's current recommended way to host a static SPA (functionally the same as Pages, just deployed via Wrangler instead of the Pages dashboard). From the repo root:

```powershell
npx wrangler login
npx wrangler deploy
```

Wrangler isn't in `package.json` yet, so `npx` will fetch it on first run — or add it with `pnpm add -D wrangler -w` if you want it pinned.

Then attach your domain: **Workers & Pages → your project → Custom Domains → Add** `photos.example.org`. It must exactly match `VITE_PUBLIC_PAGE_ORIGIN`.

## 3-alt. If you specifically want a classic Cloudflare Pages project instead

Dashboard → **Workers & Pages → Create → Pages → Connect to Git**, then:
- Root directory: `apps/public`
- Build command: `cd ../.. && pnpm install && pnpm build`
- Build output directory: `dist`
- Add `VITE_PUBLIC_PHOTO_API_URL` and `VITE_PUBLIC_PAGE_ORIGIN` as Pages environment variables (Production, and Preview if you use it)

The build-generated `apps/public/dist/_headers` file is Cloudflare's native format (Pages and Workers-assets both honor it) and adds the exact security headers plus long-cache on `/assets/*` — nothing to maintain by hand.

## 4. Sync the origin back to Supabase

Once the domain is live, make sure Supabase's Edge Function secret matches exactly:
```powershell
pnpm exec supabase secrets set --workdir supabase PUBLIC_PAGE_ORIGIN=https://photos.example.org
pnpm exec supabase functions deploy --workdir supabase
```
A mismatch here is the most common failure mode — the `photo` function does an exact-origin check (`assertExactOrigin`) and will 403 anything that doesn't match byte-for-byte.

## 5. Verify

Open `https://photos.example.org/photo#<a-real-token>` from a confirmed session and confirm the image and download button work, then check dev tools for zero CSP violations.

The committed unit tests cover fragment validation, POST-only token transport, the separate binary
routes, public states, optional registration copy, and download behavior. The page uses accessible
roles and stable `data-state` values so a browser test can exercise loading, ready, missing/expired,
and download flows without reading a secret from rendered text. The security regression tests
require the generated Cloudflare Pages response CSP to match the HTML CSP exactly, with the
configured API and R2 origins, no unresolved placeholders, and no unsafe script/style directives.

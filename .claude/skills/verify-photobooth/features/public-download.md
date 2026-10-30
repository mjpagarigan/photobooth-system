# Guest download page

A guest scans the QR code and opens a private page on their phone that shows the collage, lets them download it, and offers the recruitment action. An expired or unknown link shows a friendly unavailable state.

## Sub-features

- `public-ready` shows the collage for a valid token.
- `public-download` downloads the JPEG.
- `public-expired` shows the unavailable state for an expired or unknown token.

## How to get to it (user POV)

- Scan the QR on the final screen or Screen 2. The phone opens `/photo#<token>`.

## Driving it with verify-photobooth

Preconditions:

- Doctor is `READY`. The run starts `apps/public` in `--mode test` on port 4173 at a 390 by 844 phone viewport.

- **Run.** `pnpm exec playwright test -c .claude/skills/verify-photobooth/playwright.config.ts --project=public`.
- **Ready.** Open `/photo#AAAA…` (43 characters). The image `M.A.T. Photobooth finished event collage` shows. Evidence `public/01-ready`.
- **Download.** Tap `Download photo`; a `.jpg` download starts and the API saw `resolve`, `image`, `download` in that order. Evidence `02-after-download`.
- **Expired.** With the API answering 404 `not_found`, the text `This photo is unavailable or has expired.` shows. Evidence `03-expired`.

## Gotchas

- The API is mocked at `https://api.example.test`; every other https host is blocked. Fonts or images from a CDN will not load, and that is intended.
- The token must be 43 URL-safe characters. A malformed fragment is rejected locally with no API call.
- The real Supabase `photo` Function is not exercised. Use `pnpm smoke:photo` for that, against a configured project.

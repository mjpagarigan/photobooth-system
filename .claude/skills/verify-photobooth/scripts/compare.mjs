#!/usr/bin/env node
// Usage: node .claude/skills/verify-photobooth/scripts/compare.mjs <visual-state>=<Artboard> ...
// Needs the kiosk renderer on 4174 (pnpm --filter @grace-booth/kiosk dev:renderer) and the
// prototype artboards in artifacts/verify/prototype-apple/. Writes a side-by-side PNG per pair
// to artifacts/verify/compare/<visual-state>.png: prototype on the left, current build on the right.
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { chromium } from 'playwright';

const ROOT = resolve(import.meta.dirname, '../../../..');
const PROTOTYPE = resolve(ROOT, 'artifacts/verify/prototype-apple');
const OUT = resolve(ROOT, 'artifacts/verify/compare');
const VIEWPORT = { width: 1366, height: 768 };

const pairs = process.argv.slice(2).map((arg) => {
  const [state, artboard] = arg.split('=');
  if (!state || !artboard) throw new Error(`expected <visual-state>=<Artboard>, got ${arg}`);
  return { state, artboard };
});
if (pairs.length === 0) throw new Error('pass at least one <visual-state>=<Artboard> pair');

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: VIEWPORT });
  for (const { state, artboard } of pairs) {
    await page.goto(pathToFileURL(resolve(PROTOTYPE, `${artboard}.dc.html`)).href);
    await page.evaluate('document.fonts.ready');
    const prototype = (await page.screenshot()).toString('base64');

    const view = state.startsWith('qr-station') ? 'view=qr-station&' : '';
    await page.goto(`http://127.0.0.1:4174/?${view}visual=${state}`);
    await page.getByTestId('renderer-loading').waitFor({ state: 'detached', timeout: 30_000 });
    await page.evaluate('document.fonts.ready');
    await page.waitForTimeout(400);
    const current = (await page.screenshot()).toString('base64');

    const sheet = await browser.newPage({
      viewport: { width: VIEWPORT.width * 2 + 24, height: VIEWPORT.height + 40 },
    });
    await sheet.setContent(`<body style="margin:0;background:#888;font:13px sans-serif;color:#fff">
      <div style="display:flex;gap:24px"><b style="width:${VIEWPORT.width}px;padding:10px">Prototype: ${artboard}</b><b style="padding:10px">Current: ?visual=${state}</b></div>
      <div style="display:flex;gap:24px"><img src="data:image/png;base64,${prototype}"><img src="data:image/png;base64,${current}"></div></body>`);
    await sheet.screenshot({ path: resolve(OUT, `${state}.png`) });
    await sheet.close();
    console.log(`wrote ${resolve(OUT, `${state}.png`)}`);
  }
} finally {
  await browser.close();
}

#!/usr/bin/env node
// Usage: node .claude/skills/verify-photobooth/scripts/triptych.mjs [after-dir]
// Builds one sheet per redesigned screen in artifacts/verify/compare/final/: the Fluent baseline,
// the journey capture from after-dir (default artifacts/verify/after-redesign), and the prototype
// artboard from artifacts/verify/prototype-apple/. Needs no dev server.
import { access, mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { chromium } from 'playwright';

const ROOT = resolve(import.meta.dirname, '../../../..');
const VERIFY = resolve(ROOT, 'artifacts/verify');
const AFTER = resolve(process.argv[2] ?? resolve(VERIFY, 'after-redesign'));
const OUT = resolve(VERIFY, 'compare/final');

const SCREENS = [
  ['attract', 'guest-flow/09-attract-after-done', 'Main'],
  ['countdown', 'guest-flow/03-countdown', 'Countdown'],
  ['review', 'guest-flow/06-review-layout-2', 'Review'],
  ['processing', 'guest-flow/07-processing', 'Processing'],
  ['upload-failed', 'upload-failed/02-upload-failed', 'UploadFailed'],
  ['final-qr', 'guest-flow/08-final-qr', 'FinalQr'],
  ['screen2', 'screen2/01-latest-result-1366x768', 'Screen2Qr'],
  ['passcode', 'operator/03-passcode', 'Passcode'],
  ['settings-health', 'operator/06-settings-health', 'Health'],
  ['camera-setup', 'operator/02-camera-setup', 'CameraSetup'],
  ['frame-editor', 'operator/04-frame-editor', 'FrameEditor'],
  ['download', 'public/01-ready', 'Download', { width: 390, height: 844 }],
];

async function dataUri(path) {
  return `data:image/png;base64,${(await readFile(path)).toString('base64')}`;
}

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
try {
  for (const [name, step, artboard, size = { width: 1366, height: 768 }] of SCREENS) {
    const baseline = resolve(VERIFY, 'baseline-fluent', `${step}.png`);
    const after = resolve(AFTER, `${step}.png`);
    await access(baseline);
    await access(after);

    const proto = await browser.newPage({ viewport: size });
    await proto.goto(pathToFileURL(resolve(VERIFY, 'prototype-apple', `${artboard}.dc.html`)).href);
    await proto.evaluate('document.fonts.ready');
    const prototype = `data:image/png;base64,${(await proto.screenshot()).toString('base64')}`;
    await proto.close();

    const panel = size.width < 600 ? 360 : 640;
    const sheet = await browser.newPage({ viewport: { width: panel * 3 + 64, height: 200 } });
    await sheet.setContent(`<body style="margin:0;padding:16px;background:#888;font:600 14px sans-serif;color:#fff">
      <div style="display:flex;gap:16px;align-items:flex-start">
        ${[
          ['Fluent baseline', await dataUri(baseline)],
          ['After redesign', await dataUri(after)],
          [`Prototype: ${artboard}`, prototype],
        ]
          .map(
            ([label, src]) =>
              `<figure style="margin:0;width:${panel}px"><figcaption style="margin-bottom:8px">${label}</figcaption><img style="width:100%;display:block" src="${src}"></figure>`,
          )
          .join('')}
      </div></body>`);
    await sheet.screenshot({ path: resolve(OUT, `${name}.png`), fullPage: true });
    await sheet.close();
    console.log(`wrote ${resolve(OUT, `${name}.png`)}`);
  }
} finally {
  await browser.close();
}

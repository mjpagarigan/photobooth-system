#!/usr/bin/env node
import { existsSync, readdirSync, statSync } from 'node:fs';
import { createConnection } from 'node:net';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../../../..', import.meta.url)));
const problems = [];
const report = (label, value) => console.log(`${label.padEnd(22)} ${value}`);

const major = Number(process.versions.node.split('.')[0]);
report('node', process.version);
if (major !== 24) problems.push('Node 24 is required (package.json engines).');

const built = resolve(ROOT, 'apps/kiosk/out/main/index.js');
if (!existsSync(built)) {
  problems.push('Kiosk is not built. Run: pnpm build:kiosk');
  report('kiosk build', 'missing');
} else {
  const newestSource = newestMtime(resolve(ROOT, 'apps/kiosk/src'));
  const buildTime = statSync(built).mtimeMs;
  const stale = newestSource > buildTime;
  report('kiosk build', stale ? 'STALE (src is newer than out/)' : 'current');
  if (stale) problems.push('Kiosk build is older than apps/kiosk/src. Run: pnpm build:kiosk');
}

const playwright = resolve(ROOT, 'node_modules/@playwright/test/package.json');
report('@playwright/test', existsSync(playwright) ? 'installed' : 'missing');
if (!existsSync(playwright)) problems.push('Dependencies missing. Run: pnpm install');

for (const port of [4173, 4174]) {
  const busy = await portInUse(port);
  report(`port ${port}`, busy ? 'IN USE' : 'free');
  if (busy) {
    problems.push(
      `Port ${port} is in use. The harness refuses to reuse a server it did not start. Stop your own dev server on ${port}, or find its owner with: netstat -ano | findstr :${port}`,
    );
  }
}

report('evidence root', resolve(ROOT, 'artifacts/verify'));

if (problems.length > 0) {
  console.log('\nNOT READY');
  for (const problem of problems) console.log(`- ${problem}`);
  process.exit(1);
}
console.log('\nREADY');

function newestMtime(dir) {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    newest = Math.max(newest, entry.isDirectory() ? newestMtime(path) : statSync(path).mtimeMs);
  }
  return newest;
}

function portInUse(port) {
  return new Promise((resolvePort) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      socket.destroy();
      resolvePort(true);
    });
    socket.once('error', () => resolvePort(false));
  });
}

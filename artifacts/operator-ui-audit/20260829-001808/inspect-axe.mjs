import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await context.newPage();
const output = {};
for (const visual of ['admin-gallery', 'admin-gallery-empty', 'admin-settings', 'camera-setup']) {
  await page.goto(`http://127.0.0.1:4174/?visual=${visual}`);
  await page.waitForTimeout(1200);
  const axe = await new AxeBuilder({ page }).analyze();
  output[visual] = axe.violations
    .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
    .map(({ id, impact, nodes }) => ({
      id,
      impact,
      nodes: nodes.map(({ target, html, failureSummary }) => ({ target, html, failureSummary })),
    }));
}
console.log(JSON.stringify(output, null, 2));
await browser.close();

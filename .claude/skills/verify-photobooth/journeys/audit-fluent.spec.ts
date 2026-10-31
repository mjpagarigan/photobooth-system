import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import { PASSCODE, bootstrap, closeKiosk, evidenceDir, launchKiosk, type Kiosk } from './harness';

const ROOT = resolve(__dirname, '../../../..');
const THEME_CSS = resolve(ROOT, 'packages/ui/src/styles/theme.css');
const SCANNED = ['apps/kiosk/src/renderer', 'apps/public/src', 'packages/ui/src'];

type Palette = { colors: string[]; radii: string[]; shadows: string[]; fonts: string[] };

type Offender = { value: string; count: number; sample: string };

type ScreenAudit = {
  screen: string;
  fluentComponents: Offender[];
  fluentIcons: Offender[];
  colors: Offender[];
  fonts: Offender[];
  radii: Offender[];
  shadows: Offender[];
};

async function readPalette(): Promise<Palette> {
  const css = await readFile(THEME_CSS, 'utf8');
  const theme = css.slice(css.indexOf('@theme'), css.indexOf('@layer base'));
  const tokens = [...theme.matchAll(/--([\w-]+):\s*([^;]+);/g)].map(([, name, value]) => ({
    name: name!,
    value: value!.replace(/\s+/g, ' ').trim(),
  }));
  return {
    colors: [...new Set(tokens.filter((t) => t.name.startsWith('color-')).map((t) => t.value))],
    radii: tokens.filter((t) => t.name.startsWith('radius-')).map((t) => t.value),
    shadows: tokens.filter((t) => t.name.startsWith('shadow-')).map((t) => t.value),
    fonts: tokens
      .filter((t) => t.name.startsWith('font-') && !t.name.startsWith('font-size'))
      .map((t) => t.value),
  };
}

async function auditPage(
  page: Page,
  screen: string,
  palette: Palette,
  scopeSelector?: string,
): Promise<ScreenAudit> {
  await page.evaluate('document.fonts.ready');
  const freeze = await page.addStyleTag({
    content: '*,*::before,*::after{transition:none!important;animation:none!important}',
  });
  await page.waitForTimeout(100);
  const result = await page.evaluate(
    ({ screen, palette, scopeSelector }) => {
      const probe = document.createElement('div');
      probe.style.position = 'absolute';
      probe.style.visibility = 'hidden';
      document.body.append(probe);
      const normalize = (property: string, value: string): string => {
        probe.style.setProperty(property, value);
        const computed = getComputedStyle(probe).getPropertyValue(property);
        probe.style.removeProperty(property);
        return computed;
      };
      const canvas = document.createElement('canvas').getContext('2d', {
        willReadFrequently: true,
      })!;
      const rgbOnly = (value: string): string => {
        canvas.clearRect(0, 0, 1, 1);
        canvas.fillStyle = '#000';
        canvas.fillStyle = value;
        canvas.fillRect(0, 0, 1, 1);
        const [r, g, b, a] = canvas.getImageData(0, 0, 1, 1).data;
        return a === 0 ? 'transparent' : `${r},${g},${b}`;
      };
      const visibleLayers = (value: string): string =>
        value === 'none'
          ? ''
          : value
              .split(/,(?![^(]*\))/)
              .map((layer) => layer.trim())
              .filter((layer) => rgbOnly(/rgba?\([^)]*\)/.exec(layer)?.[0] ?? '') !== 'transparent')
              .join(', ');
      const allowedColors = [...palette.colors, '#ffffff', '#000000'].map((c) =>
        rgbOnly(normalize('color', c)).split(',').map(Number),
      );
      // Reading a translucent color back through a canvas can round a channel by 1 or 2.
      const inPalette = (rgb: string): boolean => {
        const [r = 0, g = 0, b = 0] = rgb.split(',').map(Number);
        return allowedColors.some(
          ([pr = 0, pg = 0, pb = 0]) =>
            Math.abs(pr - r) <= 2 && Math.abs(pg - g) <= 2 && Math.abs(pb - b) <= 2,
        );
      };
      const allowedShadows = new Set([...palette.shadows.map((s) => normalize('box-shadow', s))]);
      const allowedRadii = new Set([
        '0px',
        ...palette.radii.map((r) => normalize('border-top-left-radius', r)),
      ]);
      const allowedFonts = new Set(
        palette.fonts.map((f) => f.split(',')[0]!.trim().replace(/['"]/g, '')),
      );
      probe.remove();

      const tally = new Map<string, Map<string, { count: number; sample: string }>>();
      const add = (kind: string, value: string, element: Element) => {
        const bucket = tally.get(kind) ?? new Map<string, { count: number; sample: string }>();
        tally.set(kind, bucket);
        const entry = bucket.get(value);
        if (entry) entry.count += 1;
        else {
          const label =
            element.getAttribute('aria-label') ??
            element.closest('[aria-label]')?.getAttribute('aria-label') ??
            element.textContent.trim().slice(0, 40);
          const classes = (element.getAttribute('class') ?? '')
            .split(/\s+/)
            .filter((c) => c && !c.startsWith('___') && !/^f[a-z0-9]{5,}$/.test(c))
            .slice(0, 3)
            .join('.');
          bucket.set(value, {
            count: 1,
            sample: `${element.tagName.toLowerCase()}${classes ? `.${classes}` : ''} "${label}"`,
          });
        }
      };

      const dialogs = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')];
      const scope =
        (scopeSelector ? document.querySelector(scopeSelector) : null) ??
        dialogs[dialogs.length - 1] ??
        document.body;
      for (const element of scope.querySelectorAll('*')) {
        if (!(element instanceof HTMLElement || element instanceof SVGElement)) continue;
        if (!element.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;

        const classList = [...element.classList];
        const fluentIcon = classList.some((c) => c.startsWith('fui-Icon'));
        if (fluentIcon) add('fluentIcons', 'fui-Icon', element);
        for (const c of classList) {
          if (c.startsWith('fui-') && !c.startsWith('fui-Icon'))
            add('fluentComponents', c, element);
        }
        if (element instanceof SVGElement && !(element instanceof SVGSVGElement)) continue;

        const style = getComputedStyle(element);
        const colorChecks: [string, boolean][] = [
          ['color', element.textContent.trim().length > 0 && element.childElementCount === 0],
          ['background-color', true],
          ['border-top-color', parseFloat(style.borderTopWidth) > 0],
          ['border-bottom-color', parseFloat(style.borderBottomWidth) > 0],
        ];
        for (const [property, applies] of colorChecks) {
          if (!applies) continue;
          const value = style.getPropertyValue(property);
          const rgb = rgbOnly(value);
          if (rgb === 'transparent') continue;
          if (!inPalette(rgb)) add('colors', `rgb(${rgb})`, element);
        }
        if (element.textContent.trim() && element.childElementCount === 0) {
          const family = style.fontFamily.split(',')[0]!.trim().replace(/['"]/g, '');
          if (!allowedFonts.has(family)) add('fonts', family, element);
        }
        const radius = style.borderTopLeftRadius;
        const isCircle =
          radius.endsWith('%') || parseFloat(radius) >= Math.min(rect.width, rect.height) / 2;
        if (!allowedRadii.has(radius) && !isCircle) add('radii', radius, element);
        const shadow = visibleLayers(style.boxShadow);
        if (shadow && !allowedShadows.has(shadow)) add('shadows', shadow, element);
      }

      const list = (kind: string) =>
        [...(tally.get(kind) ?? new Map<string, { count: number; sample: string }>()).entries()]
          .map(([value, { count, sample }]) => ({ value, count, sample }))
          .sort((a, b) => b.count - a.count);
      return {
        screen,
        fluentComponents: list('fluentComponents'),
        fluentIcons: list('fluentIcons'),
        colors: list('colors'),
        fonts: list('fonts'),
        radii: list('radii'),
        shadows: list('shadows'),
      };
    },
    { screen, palette, scopeSelector },
  );
  await freeze.evaluate((node: Element) => {
    node.remove();
  });
  return result;
}

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const path = join(dir, entry.name);
      return entry.isDirectory() ? walk(path) : Promise.resolve([path]);
    }),
  );
  return files.flat().filter((file) => /\.(tsx?|css)$/.test(file));
}

async function staticScan(): Promise<string[]> {
  const hits: string[] = [];
  for (const root of SCANNED) {
    for (const file of await walk(resolve(ROOT, root))) {
      const lines = (await readFile(file, 'utf8')).split('\n');
      lines.forEach((line, index) => {
        if (/@fluentui\/|FluentProvider/.test(line)) {
          hits.push(`${relative(ROOT, file).replaceAll('\\', '/')}:${index + 1}  ${line.trim()}`);
        }
      });
    }
  }
  return hits;
}

const total = (audit: ScreenAudit) =>
  (['fluentComponents', 'fluentIcons', 'colors', 'fonts', 'radii', 'shadows'] as const).reduce(
    (sum, kind) => sum + audit[kind].reduce((s, o) => s + o.count, 0),
    0,
  );

function toMarkdown(audits: ScreenAudit[], imports: string[]): string {
  const kinds = ['fluentComponents', 'fluentIcons', 'colors', 'fonts', 'radii', 'shadows'] as const;
  const rows = audits.map(
    (a) =>
      `| ${a.screen} | ${kinds.map((k) => a[k].reduce((s, o) => s + o.count, 0)).join(' | ')} |`,
  );
  const details = audits.map((a) => {
    const sections = kinds
      .filter((k) => a[k].length > 0)
      .map(
        (k) =>
          `**${k}**\n\n${a[k]
            .slice(0, 8)
            .map((o) => `- \`${o.value}\` x${o.count}, e.g. ${o.sample}`)
            .join('\n')}`,
      );
    return `### ${a.screen}\n\n${sections.join('\n\n') || 'Clean.'}`;
  });
  return [
    '# Fluent audit',
    '',
    'Counts are visible elements. Allowed values come from the @theme tokens in packages/ui/src/styles/theme.css plus #fff and #000.',
    '',
    `| Screen | ${kinds.join(' | ')} |`,
    `| --- | ${kinds.map(() => '---').join(' | ')} |`,
    ...rows,
    '',
    `## @fluentui imports and FluentProvider (${imports.length})`,
    '',
    ...imports.map((hit) => `- ${hit}`),
    '',
    '## Per screen',
    '',
    ...details,
    '',
  ].join('\n');
}

test('operator screens carry no Fluent components, icons, or off-palette styles', async () => {
  test.setTimeout(300_000);
  const palette = await readPalette();
  const audits: ScreenAudit[] = [];
  let kiosk: Kiosk | null = null;
  try {
    kiosk = await launchKiosk();
    const { page } = kiosk;
    await bootstrap(page);

    await page.getByRole('button', { name: 'Recent Photos' }).first().click();
    await expect(page.getByTestId('recent-gallery')).toBeVisible();
    audits.push(await auditPage(page, 'recent-photos-dialog', palette));
    await page.getByRole('button', { name: 'Close recent photos' }).click();

    await page.getByRole('button', { name: 'Camera Setup' }).click();
    await expect(page.getByRole('dialog')).toContainText('Camera configuration');
    audits.push(await auditPage(page, 'camera-setup', palette));
    await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await page.getByRole('button', { name: 'Admin' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    audits.push(await auditPage(page, 'passcode', palette));
    await page.locator('#operator-passcode').fill(PASSCODE);
    await page.getByRole('button', { name: 'Unlock' }).click();
    await expect(page.getByTestId('admin-shell')).toBeVisible({ timeout: 45_000 });

    await page.getByRole('button', { name: 'Frame editor' }).click();
    await expect(page.getByTestId('frame-editor')).toBeVisible();
    audits.push(await auditPage(page, 'admin-frame-editor', palette));

    await page.getByRole('button', { name: 'Recent photos' }).click();
    audits.push(await auditPage(page, 'admin-recent-photos', palette));

    await page.getByRole('button', { name: 'Settings & health' }).click();
    await expect(page.getByTestId('admin-settings')).toBeVisible();
    audits.push(await auditPage(page, 'admin-shell', palette, '.admin-nav'));
    for (const [link, id] of [
      ['Overview', 'overview'],
      ['Network', 'network'],
      ['Displays', 'displays'],
      ['Google Photos', 'google'],
      ['Security & Cloud', 'security'],
      ['Upload queue', 'queue'],
    ] as const) {
      await page
        .getByRole('navigation', { name: 'Settings sections' })
        .getByRole('link', { name: link })
        .click();
      await expect(page.locator(`#settings-${id}`)).toBeInViewport();
      audits.push(await auditPage(page, `settings-${id}`, palette, `#settings-${id}`));
    }
  } finally {
    await closeKiosk(kiosk);
  }

  const imports = await staticScan();
  const dir = resolve(evidenceDir(), 'fluent-audit');
  await mkdir(dir, { recursive: true });
  await writeFile(
    resolve(dir, 'report.json'),
    JSON.stringify({ palette, audits, imports }, null, 2),
  );
  await writeFile(resolve(dir, 'report.md'), toMarkdown(audits, imports));

  expect(imports, 'no @fluentui imports or FluentProvider remain').toEqual([]);
  for (const audit of audits) expect(total(audit), `${audit.screen} is clean`).toBe(0);
});

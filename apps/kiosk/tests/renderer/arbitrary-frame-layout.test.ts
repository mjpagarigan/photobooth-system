import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const styles = readFileSync(new URL('../../src/renderer/styles.css', import.meta.url), 'utf8');

function ruleFor(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(styles);
  if (!match?.[1]) throw new Error(`Missing CSS rule for ${selector}`);
  return match[1];
}

describe('arbitrary frame presentation', () => {
  it('does not force finished photos into the legacy portrait strip', () => {
    const root = ruleFor('.photostrip--collage');
    const image = ruleFor('.photostrip__collage');

    expect(root).not.toMatch(/aspect-ratio:\s*1\s*\/\s*3/);
    expect(root).toMatch(/background:\s*transparent/);
    expect(image).not.toMatch(/aspect-ratio:\s*1\s*\/\s*3/);
    expect(image).toMatch(/object-fit:\s*contain/);
  });

  it('gives landscape review cards a landscape footprint', () => {
    const landscapeCard = ruleFor('.review-option-card.is-landscape');
    expect(landscapeCard).toMatch(/max-width:\s*640px/);
    expect(landscapeCard).toMatch(/height:\s*min\(440px,\s*100%\)/);
  });
});

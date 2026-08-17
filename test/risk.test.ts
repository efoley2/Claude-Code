import { describe, it, expect } from 'vitest';
import axe from 'axe-core';
import {
  classifyUrl,
  exposureBand,
  exposureScore,
  isMappedRule,
  mappedRuleIds,
  riskForRule,
  scoreFinding,
  stageWeight,
} from '../src/risk.js';

/**
 * Mirrors AXE_TAGS in src/scanner.ts. Duplicated rather than imported because
 * importing the scanner pulls in Playwright, which these tests do not need.
 */
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'];

/** The rules axe will actually select for, given the tags the scanner passes. */
const scannerRuleIds = new Set(axe.getRules(AXE_TAGS).map((r) => r.ruleId));

describe('classifyUrl', () => {
  it('identifies the home page', () => {
    expect(classifyUrl('https://shop.example/')).toBe('home');
    expect(classifyUrl('https://shop.example')).toBe('home');
  });

  it('identifies transactional pages', () => {
    expect(classifyUrl('https://shop.example/cart')).toBe('cart');
    expect(classifyUrl('https://shop.example/checkout')).toBe('checkout');
    expect(classifyUrl('https://shop.example/products/blue-scarf')).toBe('product');
    expect(classifyUrl('https://shop.example/collections/winter')).toBe('collection');
    expect(classifyUrl('https://shop.example/contact-us')).toBe('contact');
  });

  it('prefers the more specific stage when paths overlap', () => {
    // A checkout URL that also contains "cart" must not be downgraded to cart.
    expect(classifyUrl('https://shop.example/cart/checkout')).toBe('checkout');
  });

  it('falls back to other for unrecognised paths', () => {
    expect(classifyUrl('https://shop.example/blog/how-we-dye-wool')).toBe('other');
  });

  it('does not throw on malformed input', () => {
    expect(() => classifyUrl('not a url')).not.toThrow();
    expect(classifyUrl('/cart')).toBe('cart');
  });
});

describe('riskForRule', () => {
  it('ranks missing alt text as the top tier', () => {
    // The most-cited barrier in filed complaints must never be downgraded.
    expect(riskForRule('image-alt', 'critical').tier).toBe('critical');
  });

  it('ranks unlabelled dropdowns as critical', () => {
    expect(riskForRule('select-name', 'serious').tier).toBe('critical');
  });

  it('ranks contrast as high rather than critical', () => {
    expect(riskForRule('color-contrast', 'serious').tier).toBe('high');
  });

  it('ranks unlabelled custom widgets with the other unnamed controls', () => {
    expect(riskForRule('aria-tab-name', 'serious').tier).toBe('high');
  });

  it('does not inflate barriers that are rarely pleaded on their own', () => {
    expect(riskForRule('label-content-name-mismatch', 'serious').tier).toBe('moderate');
    expect(riskForRule('hidden-content', 'minor').tier).toBe('low');
  });

  it('ranks landmark hygiene below pleaded barriers', () => {
    expect(riskForRule('region', 'moderate').tier).toBe('moderate');
    expect(riskForRule('landmark-no-duplicate-main', 'moderate').tier).toBe('low');
  });

  it('never promotes an unknown rule above high', () => {
    // An unmapped rule must not displace a barrier we know gets pleaded.
    expect(riskForRule('some-future-axe-rule', 'critical').tier).toBe('high');
    expect(riskForRule('some-future-axe-rule', 'serious').tier).toBe('moderate');
    expect(riskForRule('some-future-axe-rule', 'minor').tier).toBe('low');
  });

  it('reports whether a rule was explicitly mapped', () => {
    expect(isMappedRule('image-alt')).toBe(true);
    expect(isMappedRule('some-future-axe-rule')).toBe(false);
  });

  it('always supplies a litigation note', () => {
    expect(riskForRule('image-alt', 'critical').note.length).toBeGreaterThan(20);
    expect(riskForRule('unknown-rule', 'minor').note.length).toBeGreaterThan(20);
  });
});

describe('the risk model against axe-core', () => {
  it('maps only rule ids axe-core actually ships', () => {
    // A typo or a rule axe has since renamed is invisible at runtime: it never
    // fires, so the barrier it was meant to rank falls through to the guess.
    const catalogue = new Set(axe.getRules().map((r) => r.ruleId));
    const unknown = mappedRuleIds().filter((id) => !catalogue.has(id));
    expect(unknown, `mapped rule ids not present in axe-core ${axe.version}`).toEqual([]);
  });

  it('maps only rules the scanner can actually produce', () => {
    // Existing but out of scope is just as dead as misspelled — an AAA-only or
    // deprecated rule never reaches riskForRule under the scanner's tags.
    const unreachable = mappedRuleIds().filter((id) => !scannerRuleIds.has(id));
    expect(unreachable, 'mapped rule ids axe will never select under AXE_TAGS').toEqual([]);
  });

  it('leaves no rule the scanner can produce unmapped', () => {
    // Every unmapped rule is scored by axe's impact rating instead of by
    // litigation exposure, which is the one thing this product does. If an
    // axe-core upgrade adds rules, tier them rather than deleting this test.
    const unmapped = [...scannerRuleIds].filter((id) => !isMappedRule(id));
    expect(unmapped, `axe rules with no litigation tier in axe-core ${axe.version}`).toEqual([]);
  });

  it('never states or implies compliance in a litigation note', () => {
    // These notes are rendered verbatim into the report, so they carry the same
    // constraint the report output does.
    for (const id of mappedRuleIds()) {
      const note = riskForRule(id, 'serious').note;
      expect(note.length, `note too short for ${id}`).toBeGreaterThan(20);
      expect(note, `unhedged claim in note for ${id}`).not.toMatch(
        /complian|certif|protect|guarantee|immune|lawsuit-proof|risk-free/i,
      );
    }
  });
});

describe('scoreFinding', () => {
  it('ranks one critical barrier above many low ones', () => {
    // This is the entire point of the product: a free scanner would surface
    // 50 landmark warnings above a single missing form label.
    const oneCritical = scoreFinding('critical', 1, 'product');
    const manyLow = scoreFinding('low', 50, 'other');
    expect(oneCritical).toBeGreaterThan(manyLow);
  });

  it('weights the same barrier higher on the checkout path', () => {
    const atCheckout = scoreFinding('critical', 1, 'checkout');
    const elsewhere = scoreFinding('critical', 1, 'other');
    expect(atCheckout).toBeGreaterThan(elsewhere);
    expect(atCheckout / elsewhere).toBeCloseTo(2.0, 5);
  });

  it('scales sub-linearly with instance count', () => {
    const one = scoreFinding('critical', 1, 'other');
    const hundred = scoreFinding('critical', 100, 'other');
    expect(hundred).toBeGreaterThan(one);
    // One systemic template bug should not swamp the whole report.
    expect(hundred).toBeLessThan(one * 10);
  });

  it('returns zero for no instances', () => {
    expect(scoreFinding('critical', 0, 'checkout')).toBe(0);
  });
});

describe('stageWeight', () => {
  it('orders stages by transactional importance', () => {
    expect(stageWeight('checkout')).toBeGreaterThan(stageWeight('cart'));
    expect(stageWeight('cart')).toBeGreaterThan(stageWeight('product'));
    expect(stageWeight('product')).toBeGreaterThan(stageWeight('home'));
    expect(stageWeight('home')).toBeGreaterThan(stageWeight('other'));
  });
});

describe('exposureScore', () => {
  it('reports zero for a clean scan', () => {
    expect(exposureScore(0)).toBe(0);
  });

  it('stays within 0-100', () => {
    for (const raw of [1, 100, 600, 5_000, 1_000_000]) {
      const score = exposureScore(raw);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    }
  });

  it('increases monotonically', () => {
    let previous = -1;
    for (const raw of [0, 50, 150, 400, 800, 2_000]) {
      const score = exposureScore(raw);
      expect(score).toBeGreaterThan(previous);
      previous = score;
    }
  });

  it('concentrates resolution at the low end', () => {
    // Distinguishing "clean" from "a tester finds something" matters;
    // distinguishing 40 barriers from 80 does not.
    expect(exposureScore(150) - exposureScore(50)).toBeGreaterThan(exposureScore(2_400) - exposureScore(2_300));
  });
});

describe('exposureBand', () => {
  it('never describes any score as compliant or safe', () => {
    // The FTC fined a competitor $1M for exactly this class of claim.
    for (const score of [0, 10, 30, 55, 85, 100]) {
      const { label, meaning } = exposureBand(score);
      const text = `${label} ${meaning}`.toLowerCase();
      expect(text).not.toMatch(/\bcompliant\b|\bcompliance\b|\bprotected\b|\bcertified\b|\bguarantee/);
    }
  });

  it('explicitly warns that a clean scan is not accessibility', () => {
    expect(exposureBand(0).meaning).toMatch(/does NOT mean/i);
  });
});

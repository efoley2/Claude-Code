import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { scanSite } from '../src/scanner.js';
import {
  buildOutreach,
  outreachBullets,
  outreachFindings,
  phrasedRuleIds,
  qualifyForOutreach,
} from '../src/outreach.js';
import { startFixtureServer } from './server.js';
import type { AggregatedFinding, JourneyStage, RiskTier, ScanReport } from '../src/types.js';

interface FindingSpec {
  ruleId: string;
  tier: RiskTier;
  instanceCount?: number;
  stage?: JourneyStage;
  pages?: number;
  description?: string;
}

function finding(spec: FindingSpec): AggregatedFinding {
  const stage = spec.stage ?? 'other';
  const instanceCount = spec.instanceCount ?? 1;
  const pageCount = spec.pages ?? 1;
  return {
    ruleId: spec.ruleId,
    description: spec.description ?? `${spec.ruleId} must pass`,
    helpUrl: `https://dequeuniversity.com/rules/axe/4.10/${spec.ruleId}`,
    tier: spec.tier,
    litigationNote: 'note',
    wcagCriteria: ['1.1.1'],
    instanceCount,
    pages: Array.from({ length: pageCount }, (_, i) => ({
      url: `https://shop.example/${stage}/${i}`,
      stage,
      instanceCount,
    })),
    score: 0,
  };
}

function report(specs: FindingSpec[]): ScanReport {
  const findings = specs.map(finding);
  const summary = { critical: 0, high: 0, moderate: 0, low: 0, totalInstances: 0 };
  for (const f of findings) {
    summary[f.tier] += 1;
    summary.totalInstances += f.instanceCount;
  }
  return {
    site: 'https://shop.example',
    scannedAt: new Date().toISOString(),
    platform: 'shopify',
    pagesScanned: [],
    findings,
    exposureScore: findings.length ? 50 : 0,
    summary,
    passedRuleCount: 30,
    incompleteRuleCount: 2,
  };
}

describe('outreach selection', () => {
  it('returns at most three findings by default', () => {
    const bullets = outreachBullets(
      report([
        { ruleId: 'image-alt', tier: 'critical', instanceCount: 14 },
        { ruleId: 'button-name', tier: 'critical', instanceCount: 3 },
        { ruleId: 'label', tier: 'critical', instanceCount: 2 },
        { ruleId: 'link-name', tier: 'critical', instanceCount: 9 },
        { ruleId: 'color-contrast', tier: 'high', instanceCount: 20 },
      ]),
    );
    expect(bullets).toHaveLength(3);
  });

  it('prefers a most-cited barrier over a bulkier best-practice one', () => {
    const picked = outreachFindings(
      report([
        { ruleId: 'heading-order', tier: 'low', instanceCount: 120 },
        { ruleId: 'image-alt', tier: 'critical', instanceCount: 2 },
      ]),
      1,
    );
    expect(picked[0]!.ruleId).toBe('image-alt');
  });

  it('prefers the same barrier where it sits on the purchase path', () => {
    const checkout = outreachFindings(report([{ ruleId: 'label', tier: 'critical', stage: 'checkout' }]), 1)[0]!;
    const footer = outreachFindings(report([{ ruleId: 'label', tier: 'critical', stage: 'other' }]), 1)[0]!;
    expect(checkout.selectionScore).toBeGreaterThan(footer.selectionScore);
  });

  it('prefers a countable barrier over an abstract one at the same tier', () => {
    const picked = outreachFindings(
      report([
        { ruleId: 'html-has-lang', tier: 'high' },
        { ruleId: 'color-contrast', tier: 'high' },
      ]),
      1,
    );
    expect(picked[0]!.ruleId).toBe('color-contrast');
  });

  it('ranks an unmapped rule below a phrased one of the same tier', () => {
    const picked = outreachFindings(
      report([
        { ruleId: 'some-new-axe-rule', tier: 'critical' },
        { ruleId: 'button-name', tier: 'critical' },
      ]),
    );
    expect(picked[0]!.ruleId).toBe('button-name');
    expect(picked[1]!.bullet).toMatch(/some-new-axe-rule must pass/);
  });

  it('points at a page where the claim can be checked', () => {
    const picked = outreachFindings(report([{ ruleId: 'image-alt', tier: 'critical', stage: 'product' }]), 1)[0]!;
    expect(picked.url).toMatch(/^https:\/\/shop\.example\//);
  });
});

describe('bullet phrasing', () => {
  const bulletFor = (spec: FindingSpec) => outreachBullets(report([spec]), 1)[0]!;

  it('counts the concrete thing and says where it is', () => {
    expect(bulletFor({ ruleId: 'image-alt', tier: 'critical', instanceCount: 14, stage: 'product', pages: 2 })).toBe(
      '14 images on your product pages with no alt text',
    );
  });

  it('keeps the noun singular for a single instance', () => {
    expect(bulletFor({ ruleId: 'select-name', tier: 'critical', instanceCount: 1, stage: 'product' })).toBe(
      '1 dropdown menu on your product page with no label',
    );
  });

  it('uses irregular plurals rather than bolting on an s', () => {
    expect(bulletFor({ ruleId: 'aria-toggle-field-name', tier: 'critical', instanceCount: 4 })).toMatch(
      /checkboxes and switches/,
    );
    expect(bulletFor({ ruleId: 'color-contrast', tier: 'high', instanceCount: 9 })).toMatch(/9 pieces of text/);
  });

  it('omits a location for pages off the purchase path', () => {
    expect(bulletFor({ ruleId: 'button-name', tier: 'critical', instanceCount: 2, stage: 'other' })).toBe(
      '2 buttons with no readable label',
    );
  });

  it('states page-level barriers as sentences instead of counting elements', () => {
    const bullet = bulletFor({ ruleId: 'html-has-lang', tier: 'high', instanceCount: 1 });
    expect(bullet).toMatch(/do not declare a language/);
    expect(bullet).not.toMatch(/^\d/);
  });

  it('stays short enough to paste into an email', () => {
    for (const ruleId of phrasedRuleIds()) {
      const bullet = bulletFor({ ruleId, tier: 'critical', instanceCount: 7, stage: 'checkout' });
      expect(bullet.length, `${ruleId} bullet is too long: ${bullet}`).toBeLessThanOrEqual(140);
      expect(bullet.length, `${ruleId} produced an empty bullet`).toBeGreaterThan(10);
    }
  });
});

/**
 * The same constraint test/scan.test.ts applies to the report, applied to
 * outreach — where it matters more, because an email lands on someone who did
 * not ask for it. Asserted over every phrasing in the table and every journey
 * stage, so a bad phrase fails the build the moment it is added.
 */
describe('honesty constraints on outreach copy', () => {
  const STAGES: JourneyStage[] = ['checkout', 'cart', 'product', 'collection', 'contact', 'home', 'other'];

  const everyBullet = (): string[] => {
    const out: string[] = [];
    for (const ruleId of [...phrasedRuleIds(), 'unmapped-future-rule']) {
      for (const stage of STAGES) {
        for (const instanceCount of [1, 14]) {
          out.push(...outreachBullets(report([{ ruleId, tier: 'critical', instanceCount, stage }]), 1));
        }
      }
    }
    return out;
  };

  it('never claims compliance, protection or certification', () => {
    const CLAIM = new RegExp(
      [
        /(?:is|are|now|fully|100%)\s+(?:fully\s+)?(?:compliant|accessible|protected|certified)/.source,
        /(?:guarantee|certif|ensure|assure)\w*\s+(?:\w+\s+){0,3}complian\w*/.source,
        /makes?\s+(?:your\s+)?(?:site|website)\s+(?:compliant|accessible)/.source,
      ].join('|'),
      'gi',
    );
    const NEGATED = /\b(?:not|never|n't|nor|without|rather than|same as|instead of|cannot|no\s+\w+\s+can)\b/i;

    const text = everyBullet().join('\n');
    const unnegated: string[] = [];
    for (const match of text.matchAll(CLAIM)) {
      const start = Math.max(0, (match.index ?? 0) - 90);
      if (!NEGATED.test(text.slice(start, match.index ?? 0))) {
        unnegated.push(text.slice(start, (match.index ?? 0) + match[0].length));
      }
    }
    expect(unnegated, `unnegated compliance claim in outreach copy: ${unnegated.join(' | ')}`).toEqual([]);
  });

  it('never predicts litigation or offers legal opinions', () => {
    // PLAN.md §6: cite aggregate statistics in the email you write by hand;
    // never tell a specific business it will be sued. A generated bullet is a
    // statement about markup and nothing more.
    const FORBIDDEN = /\b(sue[ds]?|suing|lawsuit|litigat\w+|demand letter|liable|liability|penalt\w+|fine[ds]?|legal|law firm|attorney|DOJ|FTC|court)\b/i;
    const offenders = everyBullet().filter((b) => FORBIDDEN.test(b));
    expect(offenders, `outreach bullet strays into legal claims: ${offenders.join(' | ')}`).toEqual([]);
  });

  it('never promises a fix, a score improvement or a guarantee', () => {
    const FORBIDDEN = /\b(guarantee\w*|risk-free|certif\w+|complian\w+|protect\w+|shield|immune|safe from)\b/i;
    const offenders = everyBullet().filter((b) => FORBIDDEN.test(b));
    expect(offenders, `outreach bullet overclaims: ${offenders.join(' | ')}`).toEqual([]);
  });
});

describe('outreach qualification', () => {
  it('flags a clean scan as do-not-contact', () => {
    const q = qualifyForOutreach(report([]));
    expect(q.qualified).toBe(false);
    expect(q.reason).toMatch(/clean/i);
  });

  it('flags a site with only low-priority findings as do-not-contact', () => {
    const q = qualifyForOutreach(
      report([
        { ruleId: 'region', tier: 'moderate', instanceCount: 8 },
        { ruleId: 'heading-order', tier: 'moderate', instanceCount: 3 },
        { ruleId: 'duplicate-id', tier: 'low', instanceCount: 40 },
      ]),
    );
    expect(q.qualified).toBe(false);
    expect(q.reason).toMatch(/critical or high/i);
  });

  it('qualifies a site with a most-cited barrier', () => {
    const q = qualifyForOutreach(report([{ ruleId: 'image-alt', tier: 'critical', instanceCount: 14 }]));
    expect(q.qualified).toBe(true);
    expect(q.reason).toBe('');
  });

  it('bundles the brief a human needs to write the email', () => {
    const brief = buildOutreach(report([{ ruleId: 'image-alt', tier: 'critical', instanceCount: 14 }]));
    expect(brief.site).toBe('https://shop.example');
    expect(brief.platform).toBe('shopify');
    expect(brief.bullets).toEqual(brief.findings.map((f) => f.bullet));
  });
});

describe('outreach against a real scan', () => {
  let server: { url: string; close: () => Promise<void> };
  let scanned: ScanReport;

  beforeAll(async () => {
    server = await startFixtureServer();
    scanned = await scanSite(server.url, { maxPages: 3, verbose: false });
  }, 180_000);

  afterAll(async () => {
    await server?.close();
  });

  it('produces three usable bullets from a site full of barriers', () => {
    const brief = buildOutreach(scanned);
    expect(brief.qualification.qualified).toBe(true);
    expect(brief.bullets).toHaveLength(3);
    for (const bullet of brief.bullets) {
      expect(bullet.trim()).toBe(bullet);
      expect(bullet.length).toBeGreaterThan(10);
    }
  });

  it('leads with a barrier of the kind demand letters enumerate', () => {
    expect(outreachFindings(scanned, 1)[0]!.tier).toBe('critical');
  });

  it('states counts that match the scan', () => {
    const top = outreachFindings(scanned, 3);
    for (const f of top) {
      const source = scanned.findings.find((s) => s.ruleId === f.ruleId)!;
      expect(f.instanceCount).toBe(source.instanceCount);
      if (/^\d/.test(f.bullet)) expect(f.bullet.startsWith(String(source.instanceCount))).toBe(true);
    }
  });
});

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { scanSite } from '../src/scanner.js';
import { renderHtmlReport, renderTerminalSummary } from '../src/report.js';
import { startFixtureServer } from './server.js';
import type { ScanReport } from '../src/types.js';

/**
 * End-to-end scan against a fixture site with known, deliberate violations.
 *
 * Running against a live site would make these tests non-deterministic and
 * dependent on someone else's deploy schedule, so the fixture encodes the
 * exact barriers we expect to find.
 */
describe('scanSite', () => {
  let server: { url: string; close: () => Promise<void> };
  let report: ScanReport;

  beforeAll(async () => {
    server = await startFixtureServer();
    report = await scanSite(server.url, { maxPages: 4, verbose: false });
  }, 180_000);

  afterAll(async () => {
    await server?.close();
  });

  const ruleIds = () => report.findings.map((f) => f.ruleId);

  it('crawls beyond the seed page', () => {
    expect(report.pagesScanned.length).toBeGreaterThan(1);
  });

  it('reaches pages across the purchase path', () => {
    const stages = new Set(report.pagesScanned.map((p) => p.stage));
    expect(stages.has('home')).toBe(true);
    // The crawler prioritises transactional pages, so at least one must appear.
    expect(stages.has('product') || stages.has('cart') || stages.has('contact')).toBe(true);
  });

  it('detects the planted missing alt text', () => {
    expect(ruleIds()).toContain('image-alt');
  });

  it('detects the planted empty button', () => {
    expect(ruleIds()).toContain('button-name');
  });

  it('detects the planted missing page language', () => {
    expect(ruleIds()).toContain('html-has-lang');
  });

  it('detects planted form labelling failures', () => {
    const found = ruleIds();
    expect(found.some((id) => id === 'label' || id === 'select-name')).toBe(true);
  });

  it('detects the planted contrast failure', () => {
    expect(ruleIds()).toContain('color-contrast');
  });

  it('ranks a most-cited barrier first', () => {
    expect(report.findings.length).toBeGreaterThan(0);
    expect(report.findings[0]!.tier).toBe('critical');
  });

  it('orders findings by descending score', () => {
    const scores = report.findings.map((f) => f.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it('ranks every critical barrier above every low one', () => {
    const worstCritical = Math.min(...report.findings.filter((f) => f.tier === 'critical').map((f) => f.score));
    const lows = report.findings.filter((f) => f.tier === 'low').map((f) => f.score);
    if (lows.length) expect(worstCritical).toBeGreaterThan(Math.max(...lows));
  });

  it('merges a rule appearing on several pages into one finding', () => {
    const imageAlt = report.findings.find((f) => f.ruleId === 'image-alt');
    expect(imageAlt).toBeDefined();
    // The fixture plants two on the home page and one on the product page.
    expect(imageAlt!.instanceCount).toBeGreaterThan(1);
    expect(ruleIds().filter((id) => id === 'image-alt')).toHaveLength(1);
  });

  it('attaches actionable fix guidance to top findings', () => {
    const top = report.findings.filter((f) => f.tier === 'critical');
    expect(top.length).toBeGreaterThan(0);
    for (const f of top) {
      expect(f.fix, `no fix guidance for ${f.ruleId}`).toBeDefined();
      expect(f.fix!.steps.length).toBeGreaterThan(0);
    }
  });

  it('records what passed, not just what failed', () => {
    expect(report.passedRuleCount).toBeGreaterThan(0);
  });

  it('produces a non-zero exposure score for a site full of barriers', () => {
    expect(report.exposureScore).toBeGreaterThan(0);
    expect(report.exposureScore).toBeLessThanOrEqual(100);
  });
});

describe('report rendering', () => {
  let server: { url: string; close: () => Promise<void> };
  let html: string;
  let report: ScanReport;

  beforeAll(async () => {
    server = await startFixtureServer();
    report = await scanSite(server.url, { maxPages: 2, verbose: false });
    html = renderHtmlReport(report);
  }, 180_000);

  afterAll(async () => {
    await server?.close();
  });

  it('never claims the site is compliant', () => {
    // The core honesty constraint. A competitor was fined $1M by the FTC for
    // claims of exactly this shape, so it is asserted rather than reviewed.
    //
    // The report necessarily *discusses* accessibility and compliance, so a
    // bare keyword match would flag its own disclaimers ("would not mean the
    // site is accessible"). What matters is whether such a phrase ever appears
    // as an affirmative claim, so each occurrence is checked for a preceding
    // negation instead.
    const CLAIM = new RegExp(
      [
        // "is/are/now compliant", "fully accessible", "100% compliant"
        /(?:is|are|now|fully|100%)\s+(?:fully\s+)?(?:compliant|accessible|protected|certified)/.source,
        // "guarantees compliance", "certify compliance", "ensures compliance"
        /(?:guarantee|certif|ensure|assure)\w*\s+(?:\w+\s+){0,3}complian\w*/.source,
        // "makes your site accessible"
        /makes?\s+(?:your\s+)?(?:site|website)\s+(?:compliant|accessible)/.source,
      ].join('|'),
      'gi',
    );
    const NEGATED = /\b(?:not|never|n't|nor|without|rather than|same as|instead of|cannot|no\s+\w+\s+can)\b/i;

    const unnegated: string[] = [];
    for (const match of html.matchAll(CLAIM)) {
      const start = Math.max(0, (match.index ?? 0) - 90);
      if (!NEGATED.test(html.slice(start, match.index ?? 0))) {
        unnegated.push(html.slice(start, (match.index ?? 0) + match[0].length));
      }
    }
    expect(unnegated, `unnegated compliance claim in report: ${unnegated.join(' | ')}`).toEqual([]);
  });

  it('states the coverage limit prominently, above the findings', () => {
    expect(html).toMatch(/does not certify compliance/i);
    const limitsIndex = html.indexOf('What this scan does and does not cover');
    const findingsIndex = html.indexOf('All findings, ranked');
    expect(limitsIndex).toBeGreaterThan(-1);
    expect(findingsIndex).toBeGreaterThan(limitsIndex);
  });

  it('discloses that automation catches only part of the picture', () => {
    expect(html).toMatch(/30[–-]60%/);
  });

  it('disclaims legal advice', () => {
    expect(html).toMatch(/not a law firm/i);
    expect(html).toMatch(/not legal advice/i);
  });

  it('escapes markup from the scanned page', () => {
    // Failing elements are echoed into the report; unescaped HTML from a
    // scanned site would be an injection vector into our own deliverable.
    expect(html).not.toMatch(/<svg width="20"/);
    expect(html).toMatch(/&lt;/);
  });

  it('renders a complete standalone document', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html.trimEnd().endsWith('</html>')).toBe(true);
    expect(html).not.toMatch(/https?:\/\/(cdn|fonts|unpkg|cdnjs)\./);
  });

  it('renders a terminal summary carrying the same caveat', () => {
    const summary = renderTerminalSummary(report);
    expect(summary).toMatch(/not a compliance certificate/i);
    expect(summary.length).toBeGreaterThan(50);
  });
});

import { createServer, type Server } from 'node:http';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  failureReason,
  mapWithConcurrency,
  parseDomainList,
  rankResults,
  reportFilename,
  scanBatch,
  toCsv,
  type BatchResult,
} from '../src/batch.js';
import { buildOutreach } from '../src/outreach.js';
import { startFixtureServer } from './server.js';
import type { AggregatedFinding, RiskTier, ScanReport } from '../src/types.js';

/** A server that refuses everything, standing in for a WAF blocking the scanner. */
async function startRefusingServer(status: number): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer((_req, res) => {
    res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' }).end('<html><body>Denied</body></html>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Failed to bind');
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** A port nothing is listening on, for a deterministic connection failure. */
async function closedPortUrl(): Promise<string> {
  const server: Server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Failed to bind');
  const url = `http://127.0.0.1:${address.port}`;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return url;
}

describe('parseDomainList', () => {
  it('ignores blanks, comments and stray whitespace', () => {
    const list = parseDomainList(
      ['# two verticals, week 3', '', '  shop-one.example  ', 'shop-two.example # replied already', '   ', '#done'].join(
        '\n',
      ),
    );
    expect(list).toEqual(['shop-one.example', 'shop-two.example']);
  });

  it('handles CRLF line endings from a spreadsheet export', () => {
    expect(parseDomainList('a.example\r\nb.example\r\n')).toEqual(['a.example', 'b.example']);
  });

  it('deduplicates the same host written different ways', () => {
    expect(parseDomainList('shop.example\nhttps://shop.example/\nSHOP.EXAMPLE')).toEqual(['shop.example']);
  });

  it('returns nothing for a file of only comments', () => {
    expect(parseDomainList('# nothing here\n\n')).toEqual([]);
  });
});

describe('mapWithConcurrency', () => {
  it('never exceeds the limit and preserves input order', async () => {
    let inFlight = 0;
    let peak = 0;
    const out = await mapWithConcurrency([10, 1, 5, 1, 8, 2, 1], 3, async (ms, i) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, ms));
      inFlight -= 1;
      return `${i}:${ms}`;
    });
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBe(3);
    expect(out).toEqual(['0:10', '1:1', '2:5', '3:1', '4:8', '5:2', '6:1']);
  });

  it('runs serially at a concurrency of one', async () => {
    let inFlight = 0;
    let peak = 0;
    await mapWithConcurrency([3, 3, 3], 1, async (ms) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, ms));
      inFlight -= 1;
    });
    expect(peak).toBe(1);
  });

  it('copes with an empty list and with a limit above the list length', async () => {
    expect(await mapWithConcurrency([], 3, async (x) => x)).toEqual([]);
    expect(await mapWithConcurrency([1, 2], 99, async (x) => x * 2)).toEqual([2, 4]);
  });
});

describe('failureReason', () => {
  it('translates browser error codes into something an operator can act on', () => {
    expect(failureReason(new Error('page.goto: net::ERR_NAME_NOT_RESOLVED at https://x/'))).toBe('DNS did not resolve');
    expect(failureReason(new Error('net::ERR_CONNECTION_REFUSED'))).toBe('connection refused');
    expect(failureReason(new Error('net::ERR_TOO_MANY_REDIRECTS'))).toBe('redirect loop');
    expect(failureReason(new Error('net::ERR_CERT_AUTHORITY_INVALID'))).toBe('TLS certificate could not be verified');
    expect(failureReason(new Error('Timeout of 30000ms exceeded for this site'))).toBe('timed out');
  });

  it('keeps only the first line of an unrecognised failure, without the call log or method prefix', () => {
    const reason = failureReason(new Error('page.goto: Something unexpected\nCall log:\n  - navigating to ...'));
    expect(reason).toBe('Something unexpected');
  });

  it('survives a thrown non-Error', () => {
    expect(failureReason('kaboom')).toBe('kaboom');
  });
});

describe('reportFilename', () => {
  it('produces a filesystem-safe name per domain', () => {
    expect(reportFilename('shop.example')).toBe('shop-example.html');
    expect(reportFilename('https://Shop.Example/store/')).toBe('shop-example-store.html');
  });
});

function fakeFinding(ruleId: string, tier: RiskTier, instanceCount: number): AggregatedFinding {
  return {
    ruleId,
    description: `${ruleId} must pass`,
    helpUrl: 'https://example.invalid/rule',
    tier,
    litigationNote: 'note',
    wcagCriteria: [],
    instanceCount,
    pages: [{ url: 'https://shop.example/products/x', stage: 'product', instanceCount }],
    score: 1,
  };
}

function fakeReport(domain: string, exposure: number, findings: AggregatedFinding[]): ScanReport {
  const summary = { critical: 0, high: 0, moderate: 0, low: 0, totalInstances: 0 };
  for (const f of findings) {
    summary[f.tier] += 1;
    summary.totalInstances += f.instanceCount;
  }
  return {
    site: `https://${domain}`,
    scannedAt: new Date().toISOString(),
    platform: 'shopify',
    pagesScanned: [],
    findings,
    exposureScore: exposure,
    summary,
    passedRuleCount: 40,
    incompleteRuleCount: 1,
  };
}

/** Mirrors what scanBatch attaches to a successful scan, without needing a browser. */
function fakeResult(domain: string, exposure: number, findings: AggregatedFinding[]): BatchResult {
  const report = fakeReport(domain, exposure, findings);
  return { domain, report, outreach: buildOutreach(report), durationMs: 100 };
}

describe('CSV output', () => {
  const results: BatchResult[] = [
    fakeResult('mid.example', 40, [fakeFinding('color-contrast', 'high', 6)]),
    { domain: 'dead.example', failure: 'DNS did not resolve', durationMs: 20 },
    fakeResult('worst.example', 88, [
      fakeFinding('image-alt', 'critical', 14),
      fakeFinding('select-name', 'critical', 2),
      fakeFinding('color-contrast', 'high', 9),
      fakeFinding('region', 'moderate', 3),
    ]),
    fakeResult('clean.example', 0, []),
    fakeResult('tidy.example', 6, [fakeFinding('region', 'moderate', 4)]),
  ];

  const csv = toCsv(results);
  const rows = csv.trimEnd().split('\n');
  const row = (domain: string) => rows.find((r) => r.startsWith(domain))!;

  it('has one header plus one row per domain', () => {
    expect(rows[0]).toBe('domain,platform,exposure,critical,high,top_rules,status,failure,finding_1,finding_2,finding_3');
    expect(rows).toHaveLength(results.length + 1);
  });

  it('ranks by exposure, worst first, with failures last', () => {
    expect(rows.slice(1).map((r) => r.split(',')[0])).toEqual([
      'worst.example',
      'mid.example',
      'tidy.example',
      'clean.example',
      'dead.example',
    ]);
  });

  it('carries the counts and the top three rule ids', () => {
    const worst = row('worst.example').split(',');
    expect(worst[1]).toBe('shopify');
    expect(worst[2]).toBe('88');
    expect(worst[3]).toBe('2');
    expect(worst[4]).toBe('1');
    expect(worst[5]).toBe('image-alt select-name color-contrast');
  });

  it('marks a clean scan DO-NOT-CONTACT', () => {
    // PLAN.md §5: never email someone whose site came back clean.
    expect(row('clean.example')).toMatch(/DO-NOT-CONTACT/);
    expect(row('clean.example')).toMatch(/clean scan/);
  });

  it('marks a site with only low-priority findings DO-NOT-CONTACT', () => {
    expect(row('tidy.example')).toMatch(/DO-NOT-CONTACT/);
  });

  it('marks a failed scan DO-NOT-CONTACT and states why it failed', () => {
    expect(row('dead.example')).toMatch(/DO-NOT-CONTACT \(scan failed\)/);
    expect(row('dead.example')).toMatch(/DNS did not resolve/);
  });

  it('qualifies only the sites with something worth writing about', () => {
    expect(row('worst.example')).toMatch(/,qualified,/);
    expect(row('mid.example')).toMatch(/,qualified,/);
    expect(rows.filter((r) => r.includes(',qualified,'))).toHaveLength(2);
  });

  it('carries pasteable findings for a qualified site', () => {
    expect(row('worst.example')).toMatch(/14 images on your product page with no alt text/);
  });

  it('quotes fields containing commas so the sheet does not shear', () => {
    const withComma = toCsv([
      fakeResult('comma.example', 30, [fakeFinding('image-alt', 'critical', 3)]),
      { domain: 'x.example', failure: 'timed out, twice', durationMs: 1 },
    ]);
    expect(withComma).toMatch(/"timed out, twice"/);
    expect(withComma.trimEnd().split('\n')).toHaveLength(3);
  });

  it('never states or implies compliance anywhere in the sheet', () => {
    const CLAIM = new RegExp(
      [
        /(?:is|are|now|fully|100%)\s+(?:fully\s+)?(?:compliant|accessible|protected|certified)/.source,
        /(?:guarantee|certif|ensure|assure)\w*\s+(?:\w+\s+){0,3}complian\w*/.source,
        /makes?\s+(?:your\s+)?(?:site|website)\s+(?:compliant|accessible)/.source,
      ].join('|'),
      'gi',
    );
    const NEGATED = /\b(?:not|never|n't|nor|without|rather than|same as|instead of|cannot|no\s+\w+\s+can)\b/i;
    const unnegated: string[] = [];
    for (const match of csv.matchAll(CLAIM)) {
      const start = Math.max(0, (match.index ?? 0) - 90);
      if (!NEGATED.test(csv.slice(start, match.index ?? 0))) unnegated.push(match[0]);
    }
    expect(unnegated, `unnegated compliance claim in CSV: ${unnegated.join(' | ')}`).toEqual([]);
  });

  it('emits a header-only sheet for an empty run', () => {
    expect(toCsv([]).trimEnd().split('\n')).toHaveLength(1);
  });
});

describe('rankResults', () => {
  it('does not mutate the input order', () => {
    const input: BatchResult[] = [
      fakeResult('a.example', 10, []),
      fakeResult('b.example', 90, []),
    ];
    rankResults(input);
    expect(input.map((r) => r.domain)).toEqual(['a.example', 'b.example']);
  });
});

/**
 * The property the whole outbound motion rests on: a run of a few hundred
 * domains is unattended, so no single bad domain may abort it.
 */
describe('scanBatch resilience', () => {
  let good: { url: string; close: () => Promise<void> };
  let refusing: { url: string; close: () => Promise<void> };
  let dead: string;
  let results: BatchResult[];

  beforeAll(async () => {
    good = await startFixtureServer();
    refusing = await startRefusingServer(403);
    dead = await closedPortUrl();
    results = await scanBatch([good.url, dead, refusing.url, `${good.url}/cart.html`], {
      concurrency: 2,
      maxPages: 2,
      timeout: 15_000,
      verbose: false,
    });
  }, 240_000);

  afterAll(async () => {
    await good?.close();
    await refusing?.close();
  });

  it('returns one result per domain, in input order', () => {
    expect(results).toHaveLength(4);
    expect(results.map((r) => r.domain)).toEqual([good.url, dead, refusing.url, `${good.url}/cart.html`]);
  });

  it('scans the reachable domain despite its neighbours failing', () => {
    expect(results[0]!.report).toBeDefined();
    expect(results[0]!.report!.findings.length).toBeGreaterThan(0);
    expect(results[0]!.failure).toBeUndefined();
  });

  it('records a reason rather than throwing when a host is unreachable', () => {
    expect(results[1]!.report).toBeUndefined();
    expect(results[1]!.failure).toBeTruthy();
    expect(results[1]!.failure).not.toMatch(/net::/);
  });

  it('treats a site that refuses the scanner as a failure, not a clean scan', () => {
    // A 403 error page scans with almost no violations. Reported as clean it
    // would silently drop the prospect from outreach, so it is a failure.
    expect(results[2]!.report).toBeUndefined();
    expect(results[2]!.failure).toMatch(/403/);
  });

  it('attaches outreach material to every successful scan', () => {
    for (const result of results.filter((r) => r.report)) {
      expect(result.outreach).toBeDefined();
      expect(result.outreach!.bullets.length).toBeGreaterThan(0);
      expect(result.outreach!.qualification.qualified).toBe(true);
    }
  });

  it('accepts a list entry that points at a specific page', () => {
    expect(results[3]!.report).toBeDefined();
    expect(results[3]!.report!.site).toMatch(/cart\.html$/);
  });

  it('times every domain, including the ones that failed', () => {
    for (const result of results) expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('produces a CSV covering the whole run', () => {
    const rows = toCsv(results).trimEnd().split('\n');
    expect(rows).toHaveLength(results.length + 1);
    expect(rows.filter((r) => r.includes('DO-NOT-CONTACT')).length).toBe(2);
  });

  it('gives up on a domain that exceeds its wall-clock budget', async () => {
    const stalling = createServer(() => {
      // Never respond: the browser hangs until the batch deadline fires.
    });
    await new Promise<void>((resolve) => stalling.listen(0, '127.0.0.1', resolve));
    const address = stalling.address();
    if (!address || typeof address === 'string') throw new Error('Failed to bind');

    try {
      const [result] = await scanBatch([`http://127.0.0.1:${address.port}`], {
        concurrency: 1,
        maxPages: 1,
        timeout: 60_000,
        siteTimeout: 3_000,
        verbose: false,
      });
      expect(result!.report).toBeUndefined();
      expect(result!.failure).toBe('timed out');
    } finally {
      stalling.closeAllConnections();
      await new Promise<void>((resolve) => stalling.close(() => resolve()));
    }
  }, 60_000);
});

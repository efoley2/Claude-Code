import { realpathSync, statSync } from 'node:fs';
import { AxeBuilder } from '@axe-core/playwright';
import { chromium, type Browser, type Page } from 'playwright';
import { classifyUrl, riskForRule, scoreFinding, stageWeight, exposureScore } from './risk.js';
import { detectPlatform } from './platform.js';
import { fixFor } from './fixes.js';
import type {
  AggregatedFinding,
  Finding,
  JourneyStage,
  PageScan,
  Platform,
  ScanReport,
  RiskTier,
} from './types.js';

/**
 * WCAG 2.1 Level A and AA. This is the standard courts and settlement
 * agreements consistently reference, and the one the EAA adopts, so it is what
 * we test against.
 *
 * `best-practice` rules are included because several of them (skip links,
 * landmark structure) are genuine barriers that WCAG only covers indirectly.
 * They are scored low so they never crowd out the tiers that matter.
 */
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'];

export interface ScanOptions {
  /** Maximum pages to scan, including the seed URL. */
  maxPages: number;
  /** Per-page navigation timeout in milliseconds. */
  timeout: number;
  /** Emit progress to stderr. */
  verbose: boolean;
}

export const DEFAULT_OPTIONS: ScanOptions = {
  maxPages: 6,
  timeout: 30_000,
  verbose: true,
};

function log(opts: ScanOptions, message: string): void {
  if (opts.verbose) process.stderr.write(`${message}\n`);
}

const LAUNCH_ARGS = ['--no-sandbox', '--disable-dev-shm-usage'];

/**
 * Respect the standard proxy environment variables.
 *
 * Chromium does not read HTTPS_PROXY on its own the way most CLI tools do, so
 * without this a scan run behind a corporate or CI egress proxy fails with an
 * opaque tunnel error. Passing NO_PROXY through keeps internal hosts direct.
 */
function proxyConfig(): { server: string; bypass?: string } | undefined {
  const server = process.env.HTTPS_PROXY ?? process.env.https_proxy ?? process.env.HTTP_PROXY ?? process.env.http_proxy;
  if (!server) return undefined;
  const bypass = process.env.NO_PROXY ?? process.env.no_proxy;
  return bypass ? { server, bypass } : { server };
}

/**
 * Find a usable Chromium.
 *
 * Container images commonly ship a pinned browser revision that will not match
 * whatever revision the installed playwright package expects, and the default
 * launch then fails with "executable doesn't exist". Rather than pinning the
 * npm package to chase the image, probe for a real binary and use it directly.
 */
function findSystemChromium(): string | undefined {
  const candidates = [
    process.env.CURBCUT_CHROMIUM_PATH,
    '/opt/pw-browsers/chromium',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
  ].filter((p): p is string => Boolean(p));

  for (const candidate of candidates) {
    try {
      // Resolves symlinks, so a link pointing straight at the binary works.
      const real = realpathSync(candidate);
      if (statSync(real).isFile()) return real;
    } catch {
      // Candidate absent; try the next.
    }
  }
  return undefined;
}

async function launchBrowser(opts: ScanOptions): Promise<Browser> {
  const proxy = proxyConfig();
  if (proxy) log(opts, `Routing browser traffic through ${proxy.server}`);

  try {
    return await chromium.launch({ args: LAUNCH_ARGS, proxy });
  } catch (err) {
    const executablePath = findSystemChromium();
    if (!executablePath) {
      throw new Error(
        `No usable Chromium found. Run "npx playwright install chromium", or set CURBCUT_CHROMIUM_PATH. Original error: ${
          (err as Error).message.split('\n')[0]
        }`,
      );
    }
    log(opts, `Bundled browser unavailable; using system Chromium at ${executablePath}`);
    return chromium.launch({ executablePath, args: LAUNCH_ARGS, proxy });
  }
}

/**
 * Pick which pages to scan.
 *
 * Scanning six random pages tells you little. Scanning the home page, a
 * collection, a product, the cart and the contact page covers the transactional
 * path a plaintiff's tester would walk, which is where barriers carry the most
 * weight. We deliberately take one page per journey stage before taking a
 * second of anything.
 */
async function discoverPages(page: Page, seedUrl: string, maxPages: number): Promise<string[]> {
  const origin = new URL(seedUrl).origin;

  const links: string[] = await page
    .evaluate(() =>
      Array.from(document.querySelectorAll('a[href]'))
        .map((a) => (a as HTMLAnchorElement).href)
        .filter(Boolean),
    )
    .catch(() => []);

  const seen = new Set<string>([normalize(seedUrl)]);
  const byStage = new Map<JourneyStage, string[]>();

  for (const raw of links) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      continue;
    }
    if (url.origin !== origin) continue;
    if (!/^https?:$/.test(url.protocol)) continue;
    // Skip assets and non-page endpoints that would waste a slot.
    if (/\.(jpe?g|png|gif|svg|webp|avif|pdf|zip|mp4|webm|css|js|ico)$/i.test(url.pathname)) continue;

    const key = normalize(url.href);
    if (seen.has(key)) continue;
    seen.add(key);

    const stage = classifyUrl(url.href);
    const bucket = byStage.get(stage) ?? [];
    bucket.push(url.href);
    byStage.set(stage, bucket);
  }

  // Highest-weight stages first, one page each, then fill remaining slots.
  const priority: JourneyStage[] = ['checkout', 'cart', 'product', 'contact', 'collection', 'home', 'other'];
  const picked: string[] = [];

  for (const stage of priority) {
    const bucket = byStage.get(stage);
    if (bucket?.length && picked.length < maxPages - 1) picked.push(bucket[0]!);
  }
  for (const stage of priority) {
    const bucket = byStage.get(stage) ?? [];
    for (const url of bucket.slice(1)) {
      if (picked.length >= maxPages - 1) break;
      picked.push(url);
    }
  }
  return picked;
}

/** Strip the fragment and trailing slash so /shop and /shop/#x count as one page. */
function normalize(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    u.hash = '';
    return u.href.replace(/\/$/, '');
  } catch {
    return rawUrl;
  }
}

async function scanPage(page: Page, url: string, opts: ScanOptions): Promise<PageScan> {
  const warnings: string[] = [];

  const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: opts.timeout });
  if (response && !response.ok()) {
    warnings.push(`Server returned HTTP ${response.status()}. Results may not reflect the real page.`);
  }

  // Settle lazy-loaded and client-rendered content. axe runs against the DOM as
  // it stands, so scanning too early produces false negatives on SPA storefronts.
  await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {
    warnings.push('Page kept loading resources; scanned once the timeout elapsed.');
  });
  await page.waitForTimeout(750);

  const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();

  const findings: Finding[] = results.violations.map((v) => {
    const risk = riskForRule(v.id, v.impact ?? 'minor');
    return {
      ruleId: v.id,
      description: v.help,
      helpUrl: v.helpUrl,
      axeImpact: v.impact ?? 'minor',
      wcagCriteria: extractWcagCriteria(v.tags),
      tier: risk.tier,
      litigationNote: risk.note,
      instances: v.nodes.map((n) => ({
        selector: Array.isArray(n.target) ? n.target.flat().join(' ') : String(n.target),
        html: (n.html ?? '').slice(0, 400),
        failureSummary: n.failureSummary ?? '',
      })),
    };
  });

  return {
    url,
    title: await page.title().catch(() => url),
    stage: classifyUrl(url),
    findings,
    warnings,
  };
}

/** Turn axe tags like "wcag111" into readable criteria like "1.1.1". */
function extractWcagCriteria(tags: string[]): string[] {
  const out: string[] = [];
  for (const tag of tags) {
    const m = /^wcag(\d)(\d)(\d+)$/.exec(tag);
    if (m) out.push(`${m[1]}.${m[2]}.${m[3]}`);
  }
  return [...new Set(out)];
}

/**
 * Roll per-page findings up into one ranked list.
 *
 * The same rule failing on five pages is one fix in one template, so it is
 * presented as a single item scored at its worst-case location rather than as
 * five separate findings.
 */
function aggregate(pages: PageScan[], platform: Platform): AggregatedFinding[] {
  const merged = new Map<string, AggregatedFinding>();

  for (const page of pages) {
    for (const finding of page.findings) {
      const existing = merged.get(finding.ruleId);
      const count = finding.instances.length;

      if (existing) {
        existing.instanceCount += count;
        existing.pages.push({ url: page.url, stage: page.stage, instanceCount: count });
      } else {
        merged.set(finding.ruleId, {
          ruleId: finding.ruleId,
          description: finding.description,
          helpUrl: finding.helpUrl,
          tier: finding.tier,
          litigationNote: finding.litigationNote,
          wcagCriteria: finding.wcagCriteria,
          instanceCount: count,
          pages: [{ url: page.url, stage: page.stage, instanceCount: count }],
          score: 0,
          fix: fixFor(finding.ruleId, platform),
          example: finding.instances[0],
        });
      }
    }
  }

  const findings = [...merged.values()];
  for (const f of findings) {
    // Score at the highest-weight page the barrier appears on: if a contrast
    // failure exists on both the footer and the checkout button, the checkout
    // instance is what defines the exposure.
    const worstStage = f.pages.reduce<JourneyStage>(
      (worst, p) => (stageWeight(p.stage) > stageWeight(worst) ? p.stage : worst),
      'other',
    );
    f.score = scoreFinding(f.tier, f.instanceCount, worstStage);
    f.pages.sort((a, b) => stageWeight(b.stage) - stageWeight(a.stage));
  }

  return findings.sort((a, b) => b.score - a.score);
}

export async function scanSite(siteUrl: string, options: Partial<ScanOptions> = {}): Promise<ScanReport> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const seed = siteUrl.startsWith('http') ? siteUrl : `https://${siteUrl}`;

  const browser = await launchBrowser(opts);
  const context = await browser.newContext({
    // Identify honestly. A scanner masquerading as a normal browser is the kind
    // of thing that gets an IP banned and is not a good look for a compliance
    // product.
    userAgent:
      'Mozilla/5.0 (compatible; Curbcut accessibility scanner; +https://curbcut.io/bot)',
    viewport: { width: 1440, height: 900 },
  });

  const pageScans: PageScan[] = [];
  let platform: Platform = 'unknown';
  let passedRuleCount = 0;
  let incompleteRuleCount = 0;

  try {
    const page = await context.newPage();

    log(opts, `Scanning ${seed}`);
    const seedScan = await scanPage(page, seed, opts);
    pageScans.push(seedScan);

    platform = await detectPlatform(page);
    log(opts, `Platform detected: ${platform}`);

    // Record coverage from the seed page so the report can state what actually
    // ran, not just what failed.
    const seedResults = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
    passedRuleCount = seedResults.passes.length;
    incompleteRuleCount = seedResults.incomplete.length;

    const targets = await discoverPages(page, seed, opts.maxPages);
    for (const url of targets) {
      log(opts, `Scanning ${url}`);
      try {
        pageScans.push(await scanPage(page, url, opts));
      } catch (err) {
        log(opts, `  skipped: ${(err as Error).message}`);
      }
    }
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }

  const findings = aggregate(pageScans, platform);
  const rawTotal = findings.reduce((sum, f) => sum + f.score, 0);

  const summary = { critical: 0, high: 0, moderate: 0, low: 0, totalInstances: 0 };
  for (const f of findings) {
    summary[f.tier] += 1;
    summary.totalInstances += f.instanceCount;
  }

  return {
    site: seed,
    scannedAt: new Date().toISOString(),
    platform,
    pagesScanned: pageScans,
    findings,
    exposureScore: exposureScore(rawTotal),
    summary,
    passedRuleCount,
    incompleteRuleCount,
  };
}

export type { RiskTier };

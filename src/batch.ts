import { scanSite } from './scanner.js';
import { buildOutreach, type OutreachBrief } from './outreach.js';
import type { ScanReport } from './types.js';

/**
 * Batch scanning: the engine behind the outbound motion in PLAN.md §5.
 *
 * The economics of this business depend on scanning a few hundred prospects
 * for well under a cent each and then leading every cold email with that
 * prospect's own findings. That only works if the run is unattended, so the
 * governing rule in this file is that a single bad domain — dead DNS, a
 * redirect loop, a WAF returning 403 to anything that is not a browser — must
 * never take the run down with it. Every domain resolves to either a report or
 * a stated reason, and the batch always finishes.
 */

export interface BatchOptions {
  /** Domains scanned in parallel. Each holds its own browser, so this is memory-bound. */
  concurrency: number;
  /** Maximum pages per domain. */
  maxPages: number;
  /** Per-page navigation timeout in milliseconds. */
  timeout: number;
  /**
   * Hard ceiling per domain, in milliseconds. Derived from maxPages × timeout
   * when omitted.
   */
  siteTimeout?: number;
  /** Emit per-domain progress to stderr. */
  verbose: boolean;
  /** Called as each domain settles, in completion order, for streaming output. */
  onResult?: (result: BatchResult, index: number) => void;
}

export const DEFAULT_BATCH_OPTIONS: BatchOptions = {
  concurrency: 3,
  maxPages: 6,
  timeout: 30_000,
  verbose: true,
};

export interface BatchResult {
  /** The domain exactly as it appeared in the input list. */
  domain: string;
  report?: ScanReport;
  outreach?: OutreachBrief;
  /** Present when the domain could not be scanned. Human-readable, not a stack trace. */
  failure?: string;
  /** Wall-clock milliseconds spent on this domain. */
  durationMs: number;
}

/**
 * Parse a domain list file.
 *
 * Lists get assembled by hand from BuiltWith exports and directory scrapes, so
 * they arrive with blank lines, `#` notes and stray whitespace. Silently
 * tolerating all of it is cheaper than making the operator clean the file.
 */
export function parseDomainList(text: string): string[] {
  const seen = new Set<string>();
  const domains: string[] = [];

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    // Deduplicate on the host so example.com and https://example.com/ are one scan.
    const key = line.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    domains.push(line);
  }
  return domains;
}

/**
 * Turn whatever the browser threw into something an operator can act on.
 *
 * Chromium reports network failures as `ERR_*` codes buried in a multi-line
 * message. A CSV column reading "DNS did not resolve" tells you to fix the
 * list; one reading `net::ERR_NAME_NOT_RESOLVED at ...` does not.
 */
const FAILURE_PATTERNS: Array<[RegExp, string]> = [
  [/ERR_NAME_NOT_RESOLVED|ENOTFOUND|getaddrinfo/i, 'DNS did not resolve'],
  [/ERR_CONNECTION_REFUSED|ECONNREFUSED/i, 'connection refused'],
  [/ERR_CONNECTION_RESET|ECONNRESET|ERR_EMPTY_RESPONSE/i, 'connection reset by the server'],
  [/ERR_CONNECTION_CLOSED|ERR_SOCKET_NOT_CONNECTED/i, 'connection closed by the server'],
  [/ERR_TOO_MANY_REDIRECTS/i, 'redirect loop'],
  [/ERR_SSL|ERR_CERT|SSL_ERROR|ERR_BAD_SSL/i, 'TLS certificate could not be verified'],
  [/ERR_TUNNEL_CONNECTION_FAILED|ERR_PROXY_CONNECTION_FAILED/i, 'egress proxy refused the connection'],
  [/ERR_ADDRESS_UNREACHABLE|ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED/i, 'host unreachable'],
  [/ERR_BLOCKED_BY|ERR_ACCESS_DENIED/i, 'blocked by the site'],
  [/ERR_TIMED_OUT|ETIMEDOUT|Timeout .* exceeded|timed out/i, 'timed out'],
  [/ERR_UNSAFE_PORT/i, 'port blocked by the browser'],
  [/ERR_ABORTED/i, 'navigation aborted'],
  [/No usable Chromium/i, 'no browser available — run "npx playwright install chromium"'],
  [/Invalid URL|Cannot navigate to invalid URL/i, 'not a usable URL'],
];

export function failureReason(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  for (const [pattern, reason] of FAILURE_PATTERNS) {
    if (pattern.test(message)) return reason;
  }
  // Unknown failure: keep the first line, which is the only part that carries
  // information, and drop Playwright's call log and method prefix.
  const first = message.split('\n')[0]!.replace(/^\w+\.\w+: /, '').trim();
  return first.slice(0, 160) || 'scan failed for an unknown reason';
}

/**
 * A scan that "succeeded" against an error page is worse than a failure,
 * because it looks clean and a clean-looking prospect silently drops out of
 * outreach. The scanner records the bad status as a warning rather than
 * throwing, so the seed page is checked here.
 */
function blockedStatus(report: ScanReport): string | undefined {
  const seed = report.pagesScanned[0];
  for (const warning of seed?.warnings ?? []) {
    const m = /Server returned HTTP (\d+)/.exec(warning);
    const status = m ? Number.parseInt(m[1]!, 10) : NaN;
    if (Number.isFinite(status) && status >= 400) {
      return status === 403 || status === 401
        ? `site refused the scanner (HTTP ${status})`
        : `site returned HTTP ${status}`;
    }
  }
  return undefined;
}

/**
 * Bound a scan in wall-clock time.
 *
 * Per-page timeouts do not cover every way a site can hang a worker — a slow
 * redirect chain that never quite times out will hold a slot indefinitely, and
 * with a default concurrency of three that stalls a third of the run. The
 * abandoned scan is left to unwind on its own; scanSite closes its browser in a
 * `finally`, so the leak is bounded by that page timeout rather than forever.
 */
async function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timeout of ${ms}ms exceeded for this site`)), ms);
  });
  work.catch(() => {});
  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

async function scanOne(domain: string, opts: BatchOptions): Promise<BatchResult> {
  const startedAt = Date.now();
  const siteTimeout = opts.siteTimeout ?? opts.maxPages * opts.timeout + 60_000;

  try {
    const report = await withDeadline(
      scanSite(domain, { maxPages: opts.maxPages, timeout: opts.timeout, verbose: false }),
      siteTimeout,
    );

    const blocked = blockedStatus(report);
    if (blocked) return { domain, failure: blocked, durationMs: Date.now() - startedAt };

    return { domain, report, outreach: buildOutreach(report), durationMs: Date.now() - startedAt };
  } catch (err) {
    return { domain, failure: failureReason(err), durationMs: Date.now() - startedAt };
  }
}

/**
 * Run `fn` over `items` with at most `limit` in flight, preserving input order
 * in the result. Workers pull from a shared cursor rather than taking fixed
 * slices, so one slow domain does not idle the others.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  const workerCount = Math.max(1, Math.min(Math.floor(limit) || 1, items.length));
  let next = 0;

  async function worker(): Promise<void> {
    for (let index = next++; index < items.length; index = next++) {
      results[index] = await fn(items[index]!, index);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}

/**
 * Scan every domain with bounded concurrency.
 *
 * Results come back in input order regardless of completion order, so a CSV
 * diffs cleanly against a previous run of the same list.
 */
export async function scanBatch(domains: string[], options: Partial<BatchOptions> = {}): Promise<BatchResult[]> {
  const opts = { ...DEFAULT_BATCH_OPTIONS, ...options };
  let done = 0;

  return mapWithConcurrency(domains, opts.concurrency, async (domain, index) => {
    const result = await scanOne(domain, opts);
    done += 1;

    if (opts.verbose) {
      const status = result.failure ? `failed: ${result.failure}` : `exposure ${result.report!.exposureScore}`;
      process.stderr.write(`[${done}/${domains.length}] ${domain} — ${status}\n`);
    }
    opts.onResult?.(result, index);
    return result;
  });
}

const CSV_COLUMNS = [
  'domain',
  'platform',
  'exposure',
  'critical',
  'high',
  'top_rules',
  'status',
  'failure',
  'finding_1',
  'finding_2',
  'finding_3',
] as const;

function csvField(value: string | number | undefined): string {
  const s = value === undefined ? '' : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Sorted worst-first, because that is the order the operator works the list in. */
export function rankResults(results: BatchResult[]): BatchResult[] {
  return [...results].sort((a, b) => {
    const scoreA = a.report?.exposureScore ?? -1;
    const scoreB = b.report?.exposureScore ?? -1;
    if (scoreA !== scoreB) return scoreB - scoreA;
    return a.domain.localeCompare(b.domain);
  });
}

/**
 * Render the run as a CSV worksheet.
 *
 * The `status` column is load-bearing, not decorative: PLAN.md §5 forbids
 * emailing a store whose scan came back clean, and a failed scan gives you
 * nothing to lead with either. Both are marked DO-NOT-CONTACT so that filtering
 * the sheet down to sendable rows is a single obvious operation rather than a
 * judgement call made three hundred times.
 */
export function toCsv(results: BatchResult[]): string {
  const rows = [CSV_COLUMNS.join(',')];

  for (const result of rankResults(results)) {
    const { report, outreach } = result;
    const status = result.failure
      ? 'DO-NOT-CONTACT (scan failed)'
      : outreach!.qualification.qualified
        ? 'qualified'
        : `DO-NOT-CONTACT (${outreach!.qualification.reason})`;

    const bullets = outreach?.bullets ?? [];
    rows.push(
      [
        result.domain,
        report?.platform ?? '',
        report?.exposureScore ?? '',
        report?.summary.critical ?? '',
        report?.summary.high ?? '',
        report ? report.findings.slice(0, 3).map((f) => f.ruleId).join(' ') : '',
        status,
        result.failure ?? '',
        bullets[0] ?? '',
        bullets[1] ?? '',
        bullets[2] ?? '',
      ]
        .map(csvField)
        .join(','),
    );
  }

  return `${rows.join('\n')}\n`;
}

/** Filesystem-safe stem for a per-domain report file. */
export function reportFilename(domain: string): string {
  const stem =
    domain
      .replace(/^https?:\/\//i, '')
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase() || 'site';
  return `${stem}.html`;
}

/**
 * robots.txt fetching and evaluation.
 *
 * business/PLAN.md commits to respecting robots.txt, and a product whose entire
 * positioning is "the honest vendor in a market full of bad actors" does not get
 * to treat that as decorative. It is also self-interested: cold outreach that
 * begins with a crawl the site owner explicitly asked us not to perform is a
 * worse opening than no outreach at all.
 *
 * The implementation follows RFC 9309 (the Robots Exclusion Protocol) rather
 * than the loosest reading of the original 1994 draft, with two deliberate
 * departures noted at their decision points.
 */

/**
 * The product token site owners can address us by.
 *
 * Matches the User-Agent the scanner sends, so `User-agent: Curbcut` in a
 * robots.txt does what its author expects.
 */
export const USER_AGENT_TOKEN = 'curbcut';

/** robots.txt files are supposed to be small; anything past this is ignored. */
const MAX_ROBOTS_BYTES = 512 * 1024;

export interface RobotsRule {
  allow: boolean;
  /** The path pattern as written, e.g. `/cart/*.json$`. */
  pattern: string;
  matcher: RegExp;
}

/** Which User-agent group the applicable rules came from. */
export type RobotsSource = 'named' | 'wildcard' | 'none';

export type RobotsStatus = 'ok' | 'missing' | 'unavailable';

export interface RobotsPolicy {
  /** The robots.txt URL this policy came from. */
  url: string;
  status: RobotsStatus;
  source: RobotsSource;
  rules: RobotsRule[];
  crawlDelaySeconds?: number;
  /** The site is closed to us entirely; do not scan any of it. */
  blanketDisallow: boolean;
  /** Set when robots.txt could not be read. The scan continues and says so. */
  note?: string;
}

export class RobotsDisallowedError extends Error {
  constructor(
    readonly site: string,
    reason: string,
  ) {
    super(`${site} is closed to Curbcut by robots.txt: ${reason}. Not scanning.`);
    this.name = 'RobotsDisallowedError';
  }
}

export type RobotsFetcher = (url: string) => Promise<{ status: number; body: string }>;

function stripComment(line: string): string {
  const hash = line.indexOf('#');
  return hash === -1 ? line : line.slice(0, hash);
}

/**
 * Turn a robots.txt path pattern into an anchored regex.
 *
 * `*` matches any run of characters and a trailing `$` anchors the end of the
 * path; a `$` anywhere else is a literal, which is what every major crawler
 * does and what the spec's grammar implies.
 */
function compilePattern(raw: string): RegExp {
  const anchorEnd = raw.endsWith('$');
  const body = anchorEnd ? raw.slice(0, -1) : raw;
  const source = body
    .split('*')
    .map((chunk) => chunk.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${source}${anchorEnd ? '$' : ''}`);
}

/**
 * `Disallow:` with an empty value is the documented way to allow everything, so
 * it yields no rule rather than a rule matching every path.
 */
function normalizePattern(value: string): string | undefined {
  if (!value) return undefined;
  return value.startsWith('/') || value.startsWith('*') ? value : `/${value}`;
}

/** `Curbcut/1.0` and `Curbcut` address the same crawler. */
function productToken(value: string): string {
  return value.split('/')[0]!.trim();
}

interface RobotsGroup {
  rules: RobotsRule[];
  crawlDelaySeconds?: number;
}

export interface ParsedRobots extends RobotsGroup {
  source: RobotsSource;
}

/**
 * Parse a robots.txt into the group that applies to us.
 *
 * Consecutive `User-agent` lines share one group, groups repeating the same
 * agent are merged, and a group naming us wins outright over `*` — a site owner
 * who writes a Curbcut-specific group means it to replace the wildcard, not to
 * be combined with it.
 */
export function parseRobots(text: string, token: string = USER_AGENT_TOKEN): ParsedRobots {
  const groups = new Map<string, RobotsGroup>();
  let agents: string[] = [];
  let collectingAgents = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = stripComment(rawLine).trim();
    if (!line) continue;

    const separator = line.indexOf(':');
    if (separator < 1) continue;
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (field === 'user-agent') {
      if (!collectingAgents) {
        agents = [];
        collectingAgents = true;
      }
      agents.push(value.toLowerCase());
      continue;
    }
    if (field !== 'allow' && field !== 'disallow' && field !== 'crawl-delay') continue;

    collectingAgents = false;
    // Rules before any User-agent line belong to no group, so they bind nobody.
    if (!agents.length) continue;

    for (const agent of agents) {
      const group = groups.get(agent) ?? { rules: [] };
      groups.set(agent, group);

      if (field === 'crawl-delay') {
        const seconds = Number.parseFloat(value);
        if (Number.isFinite(seconds) && seconds > 0) {
          group.crawlDelaySeconds = Math.max(group.crawlDelaySeconds ?? 0, seconds);
        }
        continue;
      }

      const pattern = normalizePattern(value);
      if (!pattern) continue;
      group.rules.push({ allow: field === 'allow', pattern, matcher: compilePattern(pattern) });
    }
  }

  const wanted = productToken(token).toLowerCase();
  for (const [agent, group] of groups) {
    if (productToken(agent) === wanted) return { ...group, source: 'named' };
  }
  const wildcard = groups.get('*');
  if (wildcard) return { ...wildcard, source: 'wildcard' };
  return { rules: [], source: 'none' };
}

/**
 * Whether a path is allowed.
 *
 * The longest matching pattern wins regardless of the order rules appear in,
 * and `Allow` beats `Disallow` on an exact-length tie. That combination is what
 * makes the common `Disallow: /admin` + `Allow: /admin/public` shape work.
 */
export function pathAllowed(policy: Pick<RobotsPolicy, 'rules'>, path: string): boolean {
  const target = path.startsWith('/') ? path : `/${path}`;
  let best: RobotsRule | undefined;

  for (const rule of policy.rules) {
    if (!rule.matcher.test(target)) continue;
    if (!best) {
      best = rule;
      continue;
    }
    if (rule.pattern.length > best.pattern.length) best = rule;
    else if (rule.pattern.length === best.pattern.length && rule.allow) best = rule;
  }

  return best ? best.allow : true;
}

/** The path-and-query robots.txt matches against, which excludes the fragment. */
export function pathFromUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    return `${url.pathname}${url.search}`;
  } catch {
    return rawUrl;
  }
}

/**
 * A `Disallow: /` group with nothing allowing anything back.
 *
 * Kept narrower than "the seed page is disallowed": a site may close its root
 * while leaving a catalogue open, and refusing to scan that would be us
 * over-reading the file rather than obeying it.
 */
function isBlanketDisallow(group: ParsedRobots): boolean {
  if (!group.rules.length) return false;
  if (group.rules.some((rule) => rule.allow)) return false;
  return group.rules.some((rule) => rule.pattern === '/' || rule.pattern === '/*');
}

function openPolicy(url: string, status: RobotsStatus, note?: string): RobotsPolicy {
  return { url, status, source: 'none', rules: [], blanketDisallow: false, note };
}

/** A policy that permits everything, for callers that have opted out of robots.txt. */
export function unrestricted(url = ''): RobotsPolicy {
  return openPolicy(url, 'missing');
}

/**
 * Fetch and evaluate a site's robots.txt.
 *
 * The fetcher is injected because the scanner has to reuse the browser
 * context's HTTP stack: a scan behind an egress proxy needs robots.txt to go
 * through the same proxy as the pages, and Node's global fetch ignores
 * HTTPS_PROXY entirely.
 *
 * A missing file means "allowed", and so does an unreadable one — RFC 9309
 * treats a 5xx as a site-wide disallow, but applied to a one-off scan that
 * turns a transient blip on someone's server into a silent refusal to do the
 * job we were asked to do. The scan proceeds and the report records that
 * robots.txt could not be read.
 */
export async function fetchRobots(
  siteUrl: string,
  fetcher: RobotsFetcher,
  token: string = USER_AGENT_TOKEN,
): Promise<RobotsPolicy> {
  let url: string;
  try {
    url = `${new URL(siteUrl).origin}/robots.txt`;
  } catch {
    return openPolicy(siteUrl, 'unavailable', `Could not derive a robots.txt URL from ${siteUrl}.`);
  }

  let response: { status: number; body: string };
  try {
    response = await fetcher(url);
  } catch (err) {
    return openPolicy(
      url,
      'unavailable',
      `robots.txt could not be fetched (${(err as Error).message.split('\n')[0]}); scanned with default rate limits.`,
    );
  }

  if (response.status === 404 || response.status === 410) return openPolicy(url, 'missing');
  if (response.status >= 400 && response.status < 500) {
    return openPolicy(url, 'missing', `robots.txt returned HTTP ${response.status}; treated as no restrictions.`);
  }
  if (response.status < 200 || response.status >= 300) {
    return openPolicy(
      url,
      'unavailable',
      `robots.txt returned HTTP ${response.status}; scanned with default rate limits.`,
    );
  }

  const parsed = parseRobots(response.body.slice(0, MAX_ROBOTS_BYTES), token);
  return {
    url,
    status: 'ok',
    source: parsed.source,
    rules: parsed.rules,
    crawlDelaySeconds: parsed.crawlDelaySeconds,
    blanketDisallow: isBlanketDisallow(parsed),
  };
}

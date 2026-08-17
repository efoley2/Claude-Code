import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, afterEach } from 'vitest';
import {
  fetchRobots,
  parseRobots,
  pathAllowed,
  pathFromUrl,
  unrestricted,
  RobotsDisallowedError,
  USER_AGENT_TOKEN,
  type RobotsFetcher,
} from '../src/robots.js';
import { scanSite } from '../src/scanner.js';
import { renderHtmlReport } from '../src/report.js';

/**
 * The robots parser is the part of the scanner that decides whether we are
 * allowed to make a request at all, so it is tested against the shapes real
 * robots.txt files take rather than the tidy ones the spec uses as examples.
 */

/** Convenience: parse and ask about a path in one step. */
function allows(text: string, path: string, token = USER_AGENT_TOKEN): boolean {
  return pathAllowed(parseRobots(text, token), path);
}

describe('parseRobots', () => {
  it('allows everything when the file is empty', () => {
    const parsed = parseRobots('');
    expect(parsed.source).toBe('none');
    expect(parsed.rules).toEqual([]);
    expect(pathAllowed(parsed, '/anything')).toBe(true);
  });

  it('allows everything when the file is only comments and blank lines', () => {
    const text = '# nothing to see here\n\n   \n# really\n';
    expect(parseRobots(text).rules).toEqual([]);
    expect(allows(text, '/cart')).toBe(true);
  });

  it('strips trailing comments from a directive', () => {
    const text = 'User-agent: *\nDisallow: /cart   # keep bots out of the basket\n';
    expect(parseRobots(text).rules[0]!.pattern).toBe('/cart');
    expect(allows(text, '/cart')).toBe(false);
    expect(allows(text, '/shop')).toBe(true);
  });

  it('matches a disallowed path as a prefix', () => {
    const text = 'User-agent: *\nDisallow: /admin\n';
    expect(allows(text, '/admin')).toBe(false);
    expect(allows(text, '/admin/users')).toBe(false);
    expect(allows(text, '/administrator')).toBe(false);
    expect(allows(text, '/adm')).toBe(true);
  });

  it('treats an empty Disallow as permission for everything', () => {
    const text = 'User-agent: *\nDisallow:\n';
    expect(parseRobots(text).rules).toEqual([]);
    expect(allows(text, '/checkout')).toBe(true);
  });

  it('lets a longer Allow override a broader Disallow', () => {
    const text = 'User-agent: *\nDisallow: /admin\nAllow: /admin/public\n';
    expect(allows(text, '/admin/secret')).toBe(false);
    expect(allows(text, '/admin/public/notice')).toBe(true);
  });

  it('picks the longest match regardless of the order rules are written in', () => {
    const text = 'User-agent: *\nAllow: /shop/sale\nDisallow: /shop\n';
    expect(allows(text, '/shop/sale/hats')).toBe(true);
    expect(allows(text, '/shop/new')).toBe(false);
  });

  it('lets Allow win when patterns are the same length', () => {
    const text = 'User-agent: *\nDisallow: /cart\nAllow: /cart\n';
    expect(allows(text, '/cart')).toBe(true);
  });

  it('honours * as a wildcard inside a pattern', () => {
    const text = 'User-agent: *\nDisallow: /*/private\n';
    expect(allows(text, '/blog/private')).toBe(false);
    expect(allows(text, '/a/b/private')).toBe(false);
    expect(allows(text, '/blog/public')).toBe(true);
  });

  it('honours $ as an end-of-path anchor', () => {
    const text = 'User-agent: *\nDisallow: /*.pdf$\n';
    expect(allows(text, '/manual.pdf')).toBe(false);
    expect(allows(text, '/docs/manual.pdf')).toBe(false);
    expect(allows(text, '/manual.pdf.html')).toBe(true);
  });

  it('anchors the whole site with Disallow: /$ only at the root', () => {
    const text = 'User-agent: *\nDisallow: /$\n';
    expect(allows(text, '/')).toBe(false);
    expect(allows(text, '/products')).toBe(true);
  });

  it('matches against the query string as well as the path', () => {
    const text = 'User-agent: *\nDisallow: /*?sort=\n';
    expect(allows(text, '/shop?sort=price')).toBe(false);
    expect(allows(text, '/shop')).toBe(true);
  });

  it('does not treat regex metacharacters in a pattern as regex', () => {
    const text = 'User-agent: *\nDisallow: /a+b(c)\n';
    expect(allows(text, '/a+b(c)/d')).toBe(false);
    expect(allows(text, '/aaab')).toBe(true);
  });

  it('prefers a group naming us over the wildcard group', () => {
    const text = ['User-agent: *', 'Disallow: /', '', 'User-agent: Curbcut', 'Disallow: /cart'].join('\n');
    const parsed = parseRobots(text);
    expect(parsed.source).toBe('named');
    expect(pathAllowed(parsed, '/products')).toBe(true);
    expect(pathAllowed(parsed, '/cart')).toBe(false);
  });

  it('does not merge the wildcard group into our own group', () => {
    const text = ['User-agent: *', 'Disallow: /secret', '', 'User-agent: curbcut', 'Disallow: /cart'].join('\n');
    expect(allows(text, '/secret')).toBe(true);
  });

  it('falls back to the wildcard group when no group names us', () => {
    const text = ['User-agent: GPTBot', 'Disallow: /', '', 'User-agent: *', 'Disallow: /checkout'].join('\n');
    const parsed = parseRobots(text);
    expect(parsed.source).toBe('wildcard');
    expect(pathAllowed(parsed, '/checkout')).toBe(false);
    expect(pathAllowed(parsed, '/')).toBe(true);
  });

  it('allows everything when no group applies to us', () => {
    const text = 'User-agent: GPTBot\nDisallow: /\n';
    const parsed = parseRobots(text);
    expect(parsed.source).toBe('none');
    expect(pathAllowed(parsed, '/')).toBe(true);
  });

  it('applies one rule block to several consecutive User-agent lines', () => {
    const text = ['User-agent: Curbcut', 'User-agent: SomeoneElse', 'Disallow: /cart'].join('\n');
    expect(allows(text, '/cart')).toBe(false);
  });

  it('merges repeated groups for the same agent', () => {
    const text = [
      'User-agent: *',
      'Disallow: /cart',
      '',
      'User-agent: *',
      'Disallow: /checkout',
    ].join('\n');
    const parsed = parseRobots(text);
    expect(parsed.rules).toHaveLength(2);
    expect(pathAllowed(parsed, '/cart')).toBe(false);
    expect(pathAllowed(parsed, '/checkout')).toBe(false);
  });

  it('ignores field and agent casing', () => {
    const text = 'USER-AGENT: CURBCUT\nDISALLOW: /Cart\n';
    const parsed = parseRobots(text);
    expect(parsed.source).toBe('named');
    expect(pathAllowed(parsed, '/Cart')).toBe(false);
  });

  it('matches a versioned product token', () => {
    const text = 'User-agent: Curbcut/1.0\nDisallow: /cart\n';
    expect(parseRobots(text).source).toBe('named');
    expect(allows(text, '/cart')).toBe(false);
  });

  it('reads CRLF files', () => {
    const text = 'User-agent: *\r\nDisallow: /cart\r\n';
    expect(allows(text, '/cart')).toBe(false);
  });

  it('ignores rules written before any User-agent line', () => {
    const text = 'Disallow: /\nUser-agent: *\nDisallow: /cart\n';
    const parsed = parseRobots(text);
    expect(parsed.rules).toHaveLength(1);
    expect(pathAllowed(parsed, '/products')).toBe(true);
  });

  it('ignores directives it does not understand', () => {
    const text = ['Sitemap: https://example.com/sitemap.xml', 'Host: example.com', 'User-agent: *', 'Disallow: /cart'].join(
      '\n',
    );
    expect(parseRobots(text).rules).toHaveLength(1);
    expect(allows(text, '/cart')).toBe(false);
  });

  it('survives a soft-404 that returns HTML instead of robots.txt', () => {
    const text = '<html><head><title>Not found</title></head><body><a href="http://x/y">home</a></body></html>';
    const parsed = parseRobots(text);
    expect(parsed.rules).toEqual([]);
    expect(pathAllowed(parsed, '/cart')).toBe(true);
  });

  it('tolerates a path written without a leading slash', () => {
    const text = 'User-agent: *\nDisallow: cart\n';
    expect(allows(text, '/cart')).toBe(false);
  });

  it('reads Crawl-delay from the group that applies to us', () => {
    const text = ['User-agent: *', 'Crawl-delay: 20', '', 'User-agent: Curbcut', 'Crawl-delay: 2.5'].join('\n');
    expect(parseRobots(text).crawlDelaySeconds).toBe(2.5);
  });

  it('ignores a malformed or zero Crawl-delay', () => {
    expect(parseRobots('User-agent: *\nCrawl-delay: soon\n').crawlDelaySeconds).toBeUndefined();
    expect(parseRobots('User-agent: *\nCrawl-delay: 0\n').crawlDelaySeconds).toBeUndefined();
  });
});

describe('pathFromUrl', () => {
  it('keeps the query and drops the fragment', () => {
    expect(pathFromUrl('https://example.com/shop?sort=price#top')).toBe('/shop?sort=price');
  });

  it('returns a root path for a bare origin', () => {
    expect(pathFromUrl('https://example.com')).toBe('/');
  });
});

/** No network: the fetcher is injected precisely so these stay offline. */
function stubFetcher(status: number, body = ''): RobotsFetcher {
  return async () => ({ status, body });
}

describe('fetchRobots', () => {
  it('requests robots.txt at the origin root', async () => {
    const seen: string[] = [];
    await fetchRobots('https://example.com/deep/page?x=1', async (url) => {
      seen.push(url);
      return { status: 200, body: '' };
    });
    expect(seen).toEqual(['https://example.com/robots.txt']);
  });

  it('treats a 404 as no restrictions, without a warning', async () => {
    const policy = await fetchRobots('https://example.com', stubFetcher(404));
    expect(policy.status).toBe('missing');
    expect(policy.note).toBeUndefined();
    expect(pathAllowed(policy, '/cart')).toBe(true);
  });

  it('treats a 403 as no restrictions but records why', async () => {
    const policy = await fetchRobots('https://example.com', stubFetcher(403));
    expect(policy.status).toBe('missing');
    expect(policy.note).toMatch(/403/);
    expect(pathAllowed(policy, '/cart')).toBe(true);
  });

  it('degrades to a noted allow on a 5xx', async () => {
    const policy = await fetchRobots('https://example.com', stubFetcher(503));
    expect(policy.status).toBe('unavailable');
    expect(policy.note).toMatch(/503/);
    expect(policy.blanketDisallow).toBe(false);
    expect(pathAllowed(policy, '/cart')).toBe(true);
  });

  it('degrades to a noted allow when the fetch throws', async () => {
    // This is the case that matters in a proxied environment: an unreachable
    // robots.txt must not abort a scan the customer asked for.
    const policy = await fetchRobots('https://example.com', async () => {
      throw new Error('tunnel refused: 403\nsecond line');
    });
    expect(policy.status).toBe('unavailable');
    expect(policy.note).toMatch(/tunnel refused/);
    expect(policy.note).not.toMatch(/second line/);
    expect(pathAllowed(policy, '/')).toBe(true);
  });

  it('flags a site-wide disallow as a hard stop', async () => {
    const policy = await fetchRobots('https://example.com', stubFetcher(200, 'User-agent: *\nDisallow: /\n'));
    expect(policy.blanketDisallow).toBe(true);
  });

  it('does not call a partial closure a site-wide disallow', async () => {
    const body = 'User-agent: *\nDisallow: /\nAllow: /catalogue\n';
    const policy = await fetchRobots('https://example.com', stubFetcher(200, body));
    expect(policy.blanketDisallow).toBe(false);
    expect(pathAllowed(policy, '/catalogue')).toBe(true);
    expect(pathAllowed(policy, '/cart')).toBe(false);
  });

  it('carries Crawl-delay through to the policy', async () => {
    const policy = await fetchRobots('https://example.com', stubFetcher(200, 'User-agent: *\nCrawl-delay: 5\n'));
    expect(policy.crawlDelaySeconds).toBe(5);
  });

  it('reports an unusable site URL rather than throwing', async () => {
    const policy = await fetchRobots('not a url', stubFetcher(200));
    expect(policy.status).toBe('unavailable');
    expect(pathAllowed(policy, '/')).toBe(true);
  });
});

describe('unrestricted', () => {
  it('permits every path, for callers scanning their own site', () => {
    const policy = unrestricted('https://example.com');
    expect(policy.blanketDisallow).toBe(false);
    expect(pathAllowed(policy, '/admin/anything')).toBe(true);
  });
});

const FIXTURES = join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures');

/**
 * The bundled fixture server has no robots.txt, so this one adds it. Everything
 * else is the same static site the end-to-end scan tests use.
 */
async function startSiteWithRobots(robotsBody: string): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer(async (req, res) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (path === '/robots.txt') {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }).end(robotsBody);
      return;
    }
    try {
      const body = await readFile(join(FIXTURES, path === '/' ? 'index.html' : path.slice(1)));
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(body);
    } catch {
      res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' }).end('<html><body>Not found</body></html>');
    }
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Failed to bind fixture server');

  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/**
 * The wiring is what actually protects a site owner: a parser that gets the
 * answer right and a scanner that ignores it would be worth nothing.
 */
describe('scanSite obeying robots.txt', () => {
  let site: { url: string; close: () => Promise<void> } | undefined;

  afterEach(async () => {
    await site?.close();
    site = undefined;
  });

  it('skips a disallowed page and tells the customer it was skipped', async () => {
    site = await startSiteWithRobots('User-agent: *\nDisallow: /cart.html\n');
    const report = await scanSite(site.url, { maxPages: 4, verbose: false, minRequestDelayMs: 0 });

    const scanned = report.pagesScanned.map((page) => page.url);
    expect(scanned.some((url) => url.endsWith('/cart.html'))).toBe(false);
    expect(scanned.length).toBeGreaterThan(1);

    expect(report.warnings.join(' ')).toMatch(/robots\.txt disallows \/cart\.html/);
    // A skipped page the customer cannot see is worse than no scan at all, so
    // it has to survive into the rendered report, not just the JSON.
    expect(renderHtmlReport(report)).toMatch(/robots\.txt disallows \/cart\.html/);
  }, 180_000);

  it('scans the pages robots.txt leaves open', async () => {
    site = await startSiteWithRobots('User-agent: *\nDisallow: /nothing-here\n');
    const report = await scanSite(site.url, { maxPages: 4, verbose: false, minRequestDelayMs: 0 });

    expect(report.pagesScanned.length).toBeGreaterThan(1);
    expect(report.warnings).toEqual([]);
  }, 180_000);

  it('refuses to scan a site that closes itself to us entirely', async () => {
    site = await startSiteWithRobots('User-agent: Curbcut\nDisallow: /\n');
    await expect(scanSite(site.url, { maxPages: 4, verbose: false, minRequestDelayMs: 0 })).rejects.toBeInstanceOf(
      RobotsDisallowedError,
    );
  }, 180_000);

  it('scans anyway when the caller has opted out of robots.txt for their own site', async () => {
    site = await startSiteWithRobots('User-agent: *\nDisallow: /\n');
    const report = await scanSite(site.url, {
      maxPages: 2,
      verbose: false,
      minRequestDelayMs: 0,
      respectRobots: false,
    });
    expect(report.pagesScanned.length).toBeGreaterThan(0);
  }, 180_000);
});

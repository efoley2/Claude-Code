import { describe, it, expect } from 'vitest';
import {
  assertPublicTarget,
  classifyAddress,
  createTargetGuard,
  defaultAllowPrivateTargets,
  isPublicAddress,
  RequestPacer,
  UnsafeTargetError,
  DEFAULT_MIN_DELAY_MS,
  MAX_CRAWL_DELAY_MS,
} from '../src/safety.js';
import { scanSite } from '../src/scanner.js';

/**
 * These tests never touch DNS or the network. Name resolution is injected so
 * the guard's behaviour is asserted rather than the resolver's, and so the
 * suite cannot fail because of someone else's DNS.
 */

const BLOCKED = { allowPrivateTargets: false } as const;

/** Resolve every hostname to a fixed set of addresses. */
function resolvingTo(...addresses: string[]) {
  return { allowPrivateTargets: false, resolveHost: async () => addresses };
}

async function rejection(promise: Promise<unknown>): Promise<UnsafeTargetError> {
  try {
    await promise;
  } catch (err) {
    return err as UnsafeTargetError;
  }
  throw new Error('expected the target to be refused');
}

describe('classifyAddress', () => {
  it('accepts ordinary public addresses', () => {
    expect(classifyAddress('93.184.216.34')).toBe('public');
    expect(classifyAddress('8.8.8.8')).toBe('public');
    expect(classifyAddress('2606:2800:220:1:248:1893:25c8:1946')).toBe('public');
    expect(classifyAddress('172.32.0.1')).toBe('public');
    expect(classifyAddress('100.128.0.1')).toBe('public');
  });

  it('rejects loopback', () => {
    expect(classifyAddress('127.0.0.1')).toBe('loopback');
    expect(classifyAddress('127.1.2.3')).toBe('loopback');
    expect(classifyAddress('::1')).toBe('loopback');
    expect(classifyAddress('[::1]')).toBe('loopback');
    expect(classifyAddress('0:0:0:0:0:0:0:1')).toBe('loopback');
  });

  it('rejects the cloud metadata endpoint and the rest of link-local space', () => {
    // The single most valuable SSRF target on every major cloud provider.
    expect(classifyAddress('169.254.169.254')).toBe('link-local');
    expect(classifyAddress('169.254.0.1')).toBe('link-local');
    expect(classifyAddress('fe80::1')).toBe('link-local');
    expect(classifyAddress('febf::1')).toBe('link-local');
  });

  it('rejects RFC1918 space', () => {
    expect(classifyAddress('10.0.0.1')).toBe('private');
    expect(classifyAddress('172.16.0.1')).toBe('private');
    expect(classifyAddress('172.31.255.255')).toBe('private');
    expect(classifyAddress('192.168.1.1')).toBe('private');
    expect(classifyAddress('fd00::1')).toBe('private');
    expect(classifyAddress('fc00::1')).toBe('private');
  });

  it('rejects CGNAT space', () => {
    expect(classifyAddress('100.64.0.1')).toBe('cgnat');
    expect(classifyAddress('100.127.255.255')).toBe('cgnat');
  });

  it('rejects multicast, broadcast and reserved space', () => {
    expect(classifyAddress('224.0.0.1')).toBe('multicast');
    expect(classifyAddress('239.255.255.250')).toBe('multicast');
    expect(classifyAddress('ff02::1')).toBe('multicast');
    expect(classifyAddress('255.255.255.255')).toBe('reserved');
    expect(classifyAddress('240.0.0.1')).toBe('reserved');
    expect(classifyAddress('198.18.0.1')).toBe('reserved');
  });

  it('rejects the unspecified address', () => {
    expect(classifyAddress('0.0.0.0')).toBe('unspecified');
    expect(classifyAddress('::')).toBe('unspecified');
  });

  it('sees through IPv6 forms that wrap an IPv4 address', () => {
    // ::ffff:169.254.169.254 reaches exactly the same metadata endpoint.
    expect(classifyAddress('::ffff:169.254.169.254')).toBe('link-local');
    expect(classifyAddress('::ffff:127.0.0.1')).toBe('loopback');
    expect(classifyAddress('::ffff:7f00:1')).toBe('loopback');
    expect(classifyAddress('::127.0.0.1')).toBe('loopback');
    expect(classifyAddress('64:ff9b::169.254.169.254')).toBe('link-local');
    expect(classifyAddress('2002:a9fe:a9fe::1')).toBe('link-local');
    expect(classifyAddress('::ffff:93.184.216.34')).toBe('public');
  });

  it('ignores an IPv6 zone index', () => {
    expect(classifyAddress('fe80::1%eth0')).toBe('link-local');
  });

  it('reports anything unparseable as unknown rather than public', () => {
    expect(classifyAddress('not-an-address')).toBe('unknown');
    expect(classifyAddress('999.1.1.1')).toBe('unknown');
    expect(classifyAddress('1.2.3')).toBe('unknown');
    expect(classifyAddress('::1::2')).toBe('unknown');
    expect(isPublicAddress('not-an-address')).toBe(false);
  });
});

describe('assertPublicTarget', () => {
  it('accepts a public IP literal', async () => {
    await expect(assertPublicTarget('https://93.184.216.34/shop', BLOCKED)).resolves.toBeUndefined();
  });

  it('refuses an IP literal in private space without any DNS lookup', async () => {
    const policy = {
      allowPrivateTargets: false,
      resolveHost: async () => {
        throw new Error('resolver must not be called for an IP literal');
      },
    };
    const err = await rejection(assertPublicTarget('http://169.254.169.254/latest/meta-data/', policy));
    expect(err).toBeInstanceOf(UnsafeTargetError);
    expect(err.message).toMatch(/link-local/);
  });

  it('refuses loopback, including bracketed IPv6', async () => {
    await rejection(assertPublicTarget('http://127.0.0.1:8080/', BLOCKED));
    await rejection(assertPublicTarget('http://[::1]:8080/', BLOCKED));
  });

  it('refuses a hostname that resolves into private space', async () => {
    const err = await rejection(assertPublicTarget('https://internal.example.com/', resolvingTo('10.1.2.3')));
    expect(err.message).toMatch(/10\.1\.2\.3/);
    expect(err.message).toMatch(/private/);
  });

  it('refuses a hostname where only one of several answers is private', async () => {
    // A round-robin answer mixing public and private must not be a coin flip.
    await rejection(assertPublicTarget('https://mixed.example.com/', resolvingTo('93.184.216.34', '127.0.0.1')));
  });

  it('accepts a hostname that resolves entirely to public space', async () => {
    await expect(
      assertPublicTarget('https://shop.example.com/', resolvingTo('93.184.216.34', '2606:2800::1')),
    ).resolves.toBeUndefined();
  });

  it('refuses a hostname it cannot resolve rather than assuming it is public', async () => {
    const policy = {
      allowPrivateTargets: false,
      resolveHost: async () => {
        throw new Error('ENOTFOUND');
      },
    };
    const err = await rejection(assertPublicTarget('https://nowhere.example.com/', policy));
    expect(err.message).toMatch(/could not be resolved/);
  });

  it('refuses a hostname that resolves to nothing', async () => {
    await rejection(assertPublicTarget('https://empty.example.com/', resolvingTo()));
  });

  it('refuses schemes a website is not served over', async () => {
    for (const url of ['file:///etc/passwd', 'gopher://example.com/', 'ftp://example.com/']) {
      const err = await rejection(assertPublicTarget(url, BLOCKED));
      expect(err.message).toMatch(/not supported/);
    }
  });

  it('refuses a non-scheme even when private targets are allowed', async () => {
    await rejection(assertPublicTarget('file:///etc/passwd', { allowPrivateTargets: true }));
  });

  it('refuses a string that is not a URL', async () => {
    await rejection(assertPublicTarget('definitely not a url', BLOCKED));
  });

  it('names the environment variable that unlocks it', async () => {
    const err = await rejection(assertPublicTarget('http://127.0.0.1/', BLOCKED));
    expect(err.message).toMatch(/CURBCUT_ALLOW_PRIVATE_TARGETS/);
  });

  it('permits private targets when the caller has explicitly opted in', async () => {
    // This is the path the fixture-server integration tests take.
    await expect(assertPublicTarget('http://127.0.0.1:3000/', { allowPrivateTargets: true })).resolves.toBeUndefined();
  });
});

describe('createTargetGuard', () => {
  it('resolves a host once per scan', async () => {
    let lookups = 0;
    const guard = createTargetGuard({
      allowPrivateTargets: false,
      resolveHost: async () => {
        lookups += 1;
        return ['93.184.216.34'];
      },
    });

    await guard('https://example.com/');
    await guard('https://example.com/products');
    await guard('https://example.com/cart');
    expect(lookups).toBe(1);
  });

  it('keeps a blocked host blocked without re-resolving it', async () => {
    let lookups = 0;
    const guard = createTargetGuard({
      allowPrivateTargets: false,
      resolveHost: async () => {
        lookups += 1;
        return ['10.0.0.5'];
      },
    });

    await rejection(guard('https://internal.example.com/'));
    await rejection(guard('https://internal.example.com/other'));
    expect(lookups).toBe(1);
  });

  it('checks each host separately, so a redirect to internal space is caught', async () => {
    const guard = createTargetGuard({
      allowPrivateTargets: false,
      resolveHost: async (hostname) => (hostname === 'public.example.com' ? ['93.184.216.34'] : ['169.254.169.254']),
    });

    await expect(guard('https://public.example.com/')).resolves.toBeUndefined();
    await rejection(guard('https://metadata.example.com/'));
  });
});

describe('defaultAllowPrivateTargets', () => {
  it('is on under the test runner and off otherwise', () => {
    // The integration suite scans a loopback fixture server; production runs
    // set neither variable, so the guard is on where it matters.
    expect(defaultAllowPrivateTargets()).toBe(true);
    const saved = { vitest: process.env.VITEST, node: process.env.NODE_ENV };
    try {
      delete process.env.VITEST;
      delete process.env.NODE_ENV;
      expect(defaultAllowPrivateTargets()).toBe(false);
      process.env.CURBCUT_ALLOW_PRIVATE_TARGETS = '1';
      expect(defaultAllowPrivateTargets()).toBe(true);
    } finally {
      delete process.env.CURBCUT_ALLOW_PRIVATE_TARGETS;
      if (saved.vitest !== undefined) process.env.VITEST = saved.vitest;
      if (saved.node !== undefined) process.env.NODE_ENV = saved.node;
    }
  });
});

describe('scanSite target checking', () => {
  it('refuses a cloud metadata target before it launches a browser', async () => {
    // The whole point of the guard: a hosted scanner takes this URL from a
    // stranger, and the page body would come back inside the report.
    await expect(
      scanSite('http://169.254.169.254/latest/meta-data/', { allowPrivateTargets: false, verbose: false }),
    ).rejects.toBeInstanceOf(UnsafeTargetError);
  });

  it('refuses a loopback target when the opt-out is not set', async () => {
    // The fixture suite scans 127.0.0.1 only because it opts in; the guard
    // itself is not weakened.
    await expect(
      scanSite('http://127.0.0.1:9/', { allowPrivateTargets: false, verbose: false }),
    ).rejects.toBeInstanceOf(UnsafeTargetError);
  });
});

describe('RequestPacer', () => {
  it('lets the first request through immediately', async () => {
    const pacer = new RequestPacer(5_000);
    const started = Date.now();
    await pacer.waitTurn('https://example.com/');
    expect(Date.now() - started).toBeLessThan(200);
  });

  it('spaces out consecutive requests to the same origin', async () => {
    const pacer = new RequestPacer(80);
    const started = Date.now();
    await pacer.waitTurn('https://example.com/a');
    await pacer.waitTurn('https://example.com/b');
    await pacer.waitTurn('https://example.com/c');
    expect(Date.now() - started).toBeGreaterThanOrEqual(150);
  });

  it('paces each origin independently', async () => {
    const pacer = new RequestPacer(5_000);
    await pacer.waitTurn('https://one.example.com/');
    const started = Date.now();
    await pacer.waitTurn('https://two.example.com/');
    expect(Date.now() - started).toBeLessThan(200);
  });

  it('defaults to a delay that is polite rather than instant', () => {
    expect(new RequestPacer().delayFor('https://example.com')).toBe(DEFAULT_MIN_DELAY_MS);
  });

  it('raises its delay to match a stricter Crawl-delay', () => {
    const pacer = new RequestPacer(1_000);
    pacer.honourCrawlDelay('https://example.com', 4);
    expect(pacer.delayFor('https://example.com')).toBe(4_000);
  });

  it('never lets Crawl-delay lower our own floor', () => {
    const pacer = new RequestPacer(1_000);
    pacer.honourCrawlDelay('https://example.com', 0.1);
    expect(pacer.delayFor('https://example.com')).toBe(1_000);
  });

  it('caps an unreasonable Crawl-delay instead of hanging for an hour', () => {
    const pacer = new RequestPacer(1_000);
    pacer.honourCrawlDelay('https://example.com', 3_600);
    expect(pacer.delayFor('https://example.com')).toBe(MAX_CRAWL_DELAY_MS);
  });

  it('ignores an absent or nonsensical Crawl-delay', () => {
    const pacer = new RequestPacer(1_000);
    pacer.honourCrawlDelay('https://example.com', undefined);
    pacer.honourCrawlDelay('https://example.com', Number.NaN);
    pacer.honourCrawlDelay('https://example.com', -5);
    expect(pacer.delayFor('https://example.com')).toBe(1_000);
  });

  it('does not throw on a URL it cannot parse', async () => {
    await expect(new RequestPacer(10).waitTurn('not a url')).resolves.toBeUndefined();
  });
});

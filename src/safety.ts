import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * Guardrails for pointing a scanner at someone else's server.
 *
 * Two separate problems live here because they share one premise — we are an
 * uninvited guest on infrastructure we do not own:
 *
 * 1. **Where we are allowed to point.** The scanner takes a URL from whoever is
 *    driving it, and the moment that is a hosted form rather than a local CLI,
 *    "scan this URL" becomes a request to make an HTTP call from inside our
 *    network. `http://169.254.169.254/latest/meta-data/` returns cloud
 *    credentials on every major provider, and the page content ends up rendered
 *    into a report we hand back to the person who asked. That is a textbook
 *    SSRF read primitive, so non-public targets are refused by default.
 *
 * 2. **How hard we are allowed to knock.** business/PLAN.md commits to never
 *    hammering a site. A scan is a handful of pages, so the cost of spacing
 *    them out is seconds and the cost of not doing it is someone's morning.
 */

export type AddressScope =
  | 'public'
  | 'loopback'
  | 'private'
  | 'link-local'
  | 'cgnat'
  | 'multicast'
  | 'reserved'
  | 'unspecified'
  | 'unknown';

export class UnsafeTargetError extends Error {
  constructor(
    readonly target: string,
    readonly reason: string,
  ) {
    super(
      `Refusing to scan ${target}: ${reason}. Curbcut only scans publicly reachable sites. ` +
        'Set CURBCUT_ALLOW_PRIVATE_TARGETS=1 if you are deliberately scanning a host on your own network.',
    );
    this.name = 'UnsafeTargetError';
  }
}

export interface TargetPolicy {
  /** Permit loopback, private and link-local targets. Off outside tests. */
  allowPrivateTargets: boolean;
  /** Injectable name resolution, so tests never depend on real DNS. */
  resolveHost?: (hostname: string) => Promise<string[]>;
}

function parseIpv4(addr: string): number[] | undefined {
  const parts = addr.split('.');
  if (parts.length !== 4) return undefined;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return undefined;
    const value = Number(part);
    if (value > 255) return undefined;
    octets.push(value);
  }
  return octets;
}

function parseIpv6(addr: string): number[] | undefined {
  // Drop any zone index ("fe80::1%eth0"); it says nothing about reachability.
  const zone = addr.indexOf('%');
  let text = zone === -1 ? addr : addr.slice(0, zone);

  // Rewrite a dotted-quad tail ("::ffff:127.0.0.1") into two hextets so the
  // rest of the parser only has to deal with one notation.
  const embedded = /:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text);
  if (embedded) {
    const v4 = parseIpv4(embedded[1]!);
    if (!v4) return undefined;
    const high = ((v4[0]! << 8) | v4[1]!).toString(16);
    const low = ((v4[2]! << 8) | v4[3]!).toString(16);
    text = `${text.slice(0, embedded.index)}:${high}:${low}`;
  }

  const halves = text.split('::');
  if (halves.length > 2) return undefined;

  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const explicit = [...head, ...tail];
  if (explicit.some((group) => !/^[0-9a-fA-F]{1,4}$/.test(group))) return undefined;

  if (halves.length === 1) {
    if (explicit.length !== 8) return undefined;
    return explicit.map((group) => Number.parseInt(group, 16));
  }
  if (explicit.length > 7) return undefined;

  const zeros = new Array<string>(8 - explicit.length).fill('0');
  return [...head, ...zeros, ...tail].map((group) => Number.parseInt(group, 16));
}

function classifyIpv4(octets: number[]): AddressScope {
  const [a, b] = octets as [number, number, number, number];
  if (a === 0) return 'unspecified';
  if (a === 127) return 'loopback';
  if (a === 10) return 'private';
  if (a === 172 && b >= 16 && b <= 31) return 'private';
  if (a === 192 && b === 168) return 'private';
  if (a === 169 && b === 254) return 'link-local';
  if (a === 100 && b >= 64 && b <= 127) return 'cgnat';
  if (a >= 224 && a <= 239) return 'multicast';
  if (a >= 240) return 'reserved';
  if (a === 192 && b === 0 && octets[2] === 0) return 'reserved';
  if (a === 198 && (b === 18 || b === 19)) return 'reserved';
  return 'public';
}

function classifyIpv6(hextets: number[]): AddressScope {
  const [h0, h1, h2, h3, h4, h5, h6, h7] = hextets as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];

  const upperIsZero = h0 === 0 && h1 === 0 && h2 === 0 && h3 === 0 && h4 === 0;
  if (upperIsZero && h5 === 0 && h6 === 0 && h7 === 0) return 'unspecified';
  if (upperIsZero && h5 === 0 && h6 === 0 && h7 === 1) return 'loopback';

  // IPv4-mapped and the deprecated IPv4-compatible form both carry a real IPv4
  // address in the low 32 bits; ::ffff:169.254.169.254 must not read as public.
  if (upperIsZero && (h5 === 0xffff || h5 === 0)) return classifyIpv4(unpackIpv4(h6, h7));
  // NAT64 (64:ff9b::/96) and 6to4 (2002::/16) likewise embed an IPv4 target.
  if (h0 === 0x64 && h1 === 0xff9b && h2 === 0 && h3 === 0 && h4 === 0 && h5 === 0) {
    return classifyIpv4(unpackIpv4(h6, h7));
  }
  if (h0 === 0x2002) return classifyIpv4(unpackIpv4(h1, h2));

  if ((h0 & 0xfe00) === 0xfc00) return 'private';
  if ((h0 & 0xffc0) === 0xfe80) return 'link-local';
  if ((h0 & 0xffc0) === 0xfec0) return 'reserved';
  if ((h0 & 0xff00) === 0xff00) return 'multicast';
  return 'public';
}

function unpackIpv4(high: number, low: number): number[] {
  return [high >> 8, high & 0xff, low >> 8, low & 0xff];
}

/** Where an IP literal sits. Anything but `public` is off limits by default. */
export function classifyAddress(addr: string): AddressScope {
  const trimmed = addr.trim().replace(/^\[|\]$/g, '');
  const v4 = parseIpv4(trimmed);
  if (v4) return classifyIpv4(v4);
  const v6 = parseIpv6(trimmed);
  if (v6) return classifyIpv6(v6);
  return 'unknown';
}

export function isPublicAddress(addr: string): boolean {
  return classifyAddress(addr) === 'public';
}

async function defaultResolveHost(hostname: string): Promise<string[]> {
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
}

/**
 * Reject a target that is not on the public internet.
 *
 * Every address a hostname resolves to is checked, not just the first: a name
 * that returns one public and one private address is a deliberate bypass, and
 * round-robin DNS would otherwise make the block probabilistic.
 */
export async function assertPublicTarget(rawUrl: string, policy: TargetPolicy): Promise<void> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UnsafeTargetError(rawUrl, 'it is not a valid URL');
  }

  // file:, gopher: and friends are not things a website is served over, and
  // they are the classic escape hatch out of a URL allowlist.
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UnsafeTargetError(rawUrl, `the ${url.protocol.replace(':', '')} scheme is not supported`);
  }
  if (policy.allowPrivateTargets) return;

  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (!hostname) throw new UnsafeTargetError(rawUrl, 'it has no hostname');

  if (isIP(hostname)) {
    const scope = classifyAddress(hostname);
    if (scope !== 'public') throw new UnsafeTargetError(rawUrl, `${hostname} is a ${scope} address`);
    return;
  }

  let addresses: string[];
  try {
    addresses = await (policy.resolveHost ?? defaultResolveHost)(hostname);
  } catch (err) {
    throw new UnsafeTargetError(
      rawUrl,
      `${hostname} could not be resolved, so it cannot be confirmed public (${(err as Error).message.split('\n')[0]})`,
    );
  }
  if (!addresses.length) throw new UnsafeTargetError(rawUrl, `${hostname} resolved to no addresses`);

  for (const address of addresses) {
    const scope = classifyAddress(address);
    if (scope !== 'public') {
      throw new UnsafeTargetError(rawUrl, `${hostname} resolves to ${address}, which is a ${scope} address`);
    }
  }
}

/**
 * A memoised guard for one scan.
 *
 * A scan re-checks on every navigation so a public host cannot 302 into
 * internal space, and that would otherwise mean a DNS lookup per page for a
 * host we already cleared.
 */
export function createTargetGuard(policy: TargetPolicy): (url: string) => Promise<void> {
  const verdicts = new Map<string, Promise<void>>();

  return (rawUrl: string) => {
    let key: string;
    try {
      const url = new URL(rawUrl);
      key = `${url.protocol}//${url.host}`;
    } catch {
      return assertPublicTarget(rawUrl, policy);
    }

    // Rejections are cached alongside verdicts: a host blocked once stays
    // blocked for the rest of the scan.
    const cached = verdicts.get(key) ?? assertPublicTarget(rawUrl, policy);
    verdicts.set(key, cached);
    return cached;
  };
}

function truthy(value: string | undefined): boolean {
  return value === '1' || value === 'true' || value === 'yes';
}

/**
 * Whether private targets are permitted when the caller says nothing.
 *
 * The integration suite scans a fixture server on 127.0.0.1, which is exactly
 * what the guard exists to refuse. Rather than weakening the default or making
 * every test pass a flag, the allowance is scoped to a test runner — under
 * `npm run scan` or a hosted deployment neither variable is set, so the guard
 * is on.
 */
export function defaultAllowPrivateTargets(): boolean {
  if (truthy(process.env.CURBCUT_ALLOW_PRIVATE_TARGETS)) return true;
  return process.env.VITEST === 'true' || process.env.NODE_ENV === 'test';
}

/** Floor for the gap between two requests to the same origin. */
export const DEFAULT_MIN_DELAY_MS = 1_000;

/**
 * Ceiling on an honoured Crawl-delay.
 *
 * Some robots.txt files carry `Crawl-delay: 3600`, aimed at bulk indexers. We
 * fetch a handful of pages, so obeying that literally would hang a scan for
 * hours; capping it keeps us polite without making the tool unusable.
 */
export const MAX_CRAWL_DELAY_MS = 30_000;

/** Spaces out requests per origin, honouring robots.txt Crawl-delay when it is stricter. */
export class RequestPacer {
  private readonly delays = new Map<string, number>();
  private readonly nextSlot = new Map<string, number>();

  constructor(private readonly minDelayMs: number = DEFAULT_MIN_DELAY_MS) {}

  /** Raise this origin's delay to match robots.txt. Never lowers it. */
  honourCrawlDelay(origin: string, seconds: number | undefined): void {
    if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) return;
    const requested = Math.min(seconds * 1_000, MAX_CRAWL_DELAY_MS);
    if (requested > this.delayFor(origin)) this.delays.set(origin, requested);
  }

  delayFor(origin: string): number {
    return this.delays.get(origin) ?? this.minDelayMs;
  }

  /** Resolves once it is polite to hit `url`. The first request never waits. */
  async waitTurn(url: string): Promise<void> {
    let origin: string;
    try {
      origin = new URL(url).origin;
    } catch {
      return;
    }

    const now = Date.now();
    const slot = Math.max(now, this.nextSlot.get(origin) ?? now);
    // Claim the slot before awaiting, so concurrent callers queue behind each
    // other rather than all reading the same "now" and firing together.
    this.nextSlot.set(origin, slot + this.delayFor(origin));

    const wait = slot - now;
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  }
}

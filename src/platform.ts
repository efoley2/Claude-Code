import type { Page } from 'playwright';
import type { Platform } from './types.js';

/**
 * Detect the hosting platform from in-page signals.
 *
 * Knowing the platform is what turns "add an alt attribute" into "edit
 * snippets/product-card.liquid" — the difference between a finding a store
 * owner can act on and one they forward to an agency. Detection runs against
 * the live DOM because most of these signals are injected at runtime.
 */
export async function detectPlatform(page: Page): Promise<Platform> {
  try {
    return await page.evaluate(() => {
      const w = window as unknown as Record<string, unknown>;

      /*
       * Match against structural signals only — runtime globals, resource
       * hosts, generator meta, body classes — never raw page source.
       *
       * Searching outerHTML for a vendor name misfires on any page that merely
       * *mentions* one: a store comparing platforms in a blog post, or a
       * competitor-comparison table, gets classified as that competitor. That
       * is not cosmetic. Platform drives which remediation instructions the
       * customer receives, so a false positive hands a Shopify merchant
       * Webflow instructions that cannot work on their site.
       */
      const hosts = new Set<string>();
      const paths: string[] = [];
      for (const el of Array.from(document.querySelectorAll('script[src], link[href], img[src]'))) {
        const raw = el.getAttribute('src') ?? el.getAttribute('href');
        if (!raw) continue;
        try {
          const url = new URL(raw, document.baseURI);
          hosts.add(url.hostname.toLowerCase());
          paths.push(url.pathname.toLowerCase());
        } catch {
          // Malformed URL; nothing to learn from it.
        }
      }

      const hostMatches = (re: RegExp) => [...hosts].some((h) => re.test(h));
      const pathMatches = (re: RegExp) => paths.some((p) => re.test(p));
      const generator = (
        document.querySelector('meta[name="generator" i]')?.getAttribute('content') ?? ''
      ).toLowerCase();

      if (w.Shopify || hostMatches(/(^|\.)(cdn\.shopify\.com|shopifycloud\.com|myshopify\.com)$/)) return 'shopify';

      if (
        /\bwoocommerce\b/.test(document.body?.className ?? '') ||
        pathMatches(/\/wp-content\/plugins\/woocommerce\//) ||
        generator.includes('woocommerce')
      ) {
        return 'woocommerce';
      }

      if (w.wixBiSession || hostMatches(/(^|\.)parastorage\.com$/) || generator.includes('wix')) return 'wix';

      if (
        (w.Static as Record<string, unknown> | undefined)?.SQUARESPACE_CONTEXT ||
        hostMatches(/(^|\.)(squarespace\.com|squarespace-cdn\.com)$/)
      ) {
        return 'squarespace';
      }

      if (hostMatches(/(^|\.)bigcommerce\.com$/)) return 'bigcommerce';

      // data-wf-site is Webflow's own marker and is not something body copy carries.
      if (document.documentElement.hasAttribute('data-wf-site') || hostMatches(/(^|\.)website-files\.com$/)) {
        return 'webflow';
      }

      return 'unknown';
    });
  } catch {
    return 'unknown';
  }
}

export const PLATFORM_LABEL: Record<Platform, string> = {
  shopify: 'Shopify',
  woocommerce: 'WooCommerce',
  wix: 'Wix',
  squarespace: 'Squarespace',
  bigcommerce: 'BigCommerce',
  webflow: 'Webflow',
  unknown: 'Unknown / custom',
};

/** Where a non-developer edits templates on each platform. */
export const PLATFORM_EDIT_HINT: Record<Platform, string> = {
  shopify: 'Online Store → Themes → Edit code. Product and collection markup usually lives in sections/ and snippets/.',
  woocommerce:
    'Appearance → Theme File Editor, or override WooCommerce templates by copying them into your child theme under woocommerce/.',
  wix: 'Wix restricts template-level markup edits. Most fixes are made through element settings panels or the Velo code sidebar.',
  squarespace:
    'Most fixes are made in element settings or Design → Custom CSS. Deeper markup changes need a code block or the developer platform.',
  bigcommerce: 'Storefront → My Themes → Edit Theme Files. Stencil templates live under templates/components/.',
  webflow: 'Fixes are made on the canvas via element settings and the Style panel; alt text is set in each element\'s settings.',
  unknown: 'Locate the template that renders the affected element and edit it in your codebase.',
};

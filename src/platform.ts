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
      const html = document.documentElement.outerHTML;

      if (w.Shopify || /cdn\.shopify\.com|shopifycloud|myshopify\.com/i.test(html)) return 'shopify';
      if (
        document.body?.className.includes('woocommerce') ||
        /wp-content\/plugins\/woocommerce|wc-ajax/i.test(html)
      ) {
        return 'woocommerce';
      }
      if (w.wixBiSession || /static\.parastorage\.com|wix\.com/i.test(html)) return 'wix';
      if (
        (w.Static as Record<string, unknown> | undefined)?.SQUARESPACE_CONTEXT ||
        /static1\.squarespace\.com|squarespace\.com/i.test(html)
      ) {
        return 'squarespace';
      }
      if (/cdn\d*\.bigcommerce\.com|bigcommerce\.com/i.test(html)) return 'bigcommerce';
      if (document.documentElement.hasAttribute('data-wf-site') || /assets\.website-files\.com|webflow/i.test(html)) {
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

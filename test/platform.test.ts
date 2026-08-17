import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Browser, Page } from 'playwright';
import { launchBrowser, DEFAULT_OPTIONS } from '../src/scanner.js';
import { detectPlatform } from '../src/platform.js';

/**
 * Platform detection decides which remediation instructions a customer is
 * given, so a false positive is not cosmetic — it hands a Shopify merchant
 * Webflow instructions that cannot work on their site.
 */
describe('detectPlatform', () => {
  let browser: Browser;
  let page: Page;

  const detectIn = async (html: string) => {
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    return detectPlatform(page);
  };

  beforeAll(async () => {
    browser = await launchBrowser({ ...DEFAULT_OPTIONS, verbose: false });
    page = await browser.newPage();
  }, 120_000);

  afterAll(async () => {
    await browser?.close().catch(() => {});
  });

  it('identifies Shopify from its CDN host', async () => {
    expect(await detectIn('<script src="https://cdn.shopify.com/s/files/theme.js"></script>')).toBe('shopify');
  });

  it('identifies WooCommerce from its plugin path', async () => {
    expect(
      await detectIn('<script src="https://shop.example/wp-content/plugins/woocommerce/assets/js/cart.js"></script>'),
    ).toBe('woocommerce');
  });

  it('identifies WooCommerce from the body class', async () => {
    expect(await detectIn('<body class="woocommerce-page woocommerce">hi</body>')).toBe('woocommerce');
  });

  it('identifies Webflow from its site marker', async () => {
    expect(await detectIn('<html data-wf-site="abc123"><body>hi</body></html>')).toBe('webflow');
  });

  it('identifies Squarespace from its CDN host', async () => {
    expect(await detectIn('<img src="https://images.squarespace-cdn.com/x.jpg" alt="x">')).toBe('squarespace');
  });

  it('returns unknown for a plain site', async () => {
    expect(await detectIn('<body><h1>A shop</h1></body>')).toBe('unknown');
  });

  it('does not classify a page that merely names the platforms in its copy', async () => {
    // Our own landing page compares platforms by name and was previously
    // detected as Webflow, because the old check searched raw page source.
    const html = `
      <body>
        <h1>Which platform are you on?</h1>
        <p>We support Shopify, WooCommerce, Wix, Squarespace, BigCommerce and Webflow.</p>
        <select>
          <option>Shopify</option>
          <option>Webflow</option>
          <option>Squarespace</option>
        </select>
        <p>Read more at https://webflow.com and https://www.squarespace.com for details.</p>
      </body>`;
    expect(await detectIn(html)).toBe('unknown');
  });

  it('is not fooled by a link to a competitor', async () => {
    // A blog post linking a platform's marketing site is not that platform.
    expect(await detectIn('<a href="https://www.bigcommerce.com/pricing">BigCommerce pricing</a>')).toBe('unknown');
  });

  it('prefers the real signal when copy names a different platform', async () => {
    const html = `
      <body class="woocommerce">
        <p>Migrating from Shopify and Webflow to our new store.</p>
        <script src="https://shop.example/wp-content/plugins/woocommerce/assets/js/cart.js"></script>
      </body>`;
    expect(await detectIn(html)).toBe('woocommerce');
  });
});

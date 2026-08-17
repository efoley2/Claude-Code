import type { FixGuidance, Platform } from './types.js';
import { PLATFORM_EDIT_HINT } from './platform.js';

/**
 * Remediation guidance.
 *
 * A finding without a fix is homework. The free scanners stop at "Images must
 * have alternate text" and a link to a spec page; the gap this fills is
 * telling the owner which file to open on their platform and what to type.
 *
 * Guidance is deliberately concrete but never promises compliance — applying
 * every fix here closes the barriers that were *detected*, which is a subset
 * of the barriers that exist. That distinction is the whole product.
 */

type FixBuilder = (platform: Platform) => FixGuidance;

const generic = (platform: Platform) => PLATFORM_EDIT_HINT[platform];

const FIXES: Record<string, FixBuilder> = {
  'image-alt': (platform) => {
    const steps: string[] = [];
    if (platform === 'shopify') {
      steps.push(
        'For product photos: Products → select product → click the image → set "Alt text". This flows through every template automatically.',
        'For theme images (banners, logos, icons): Online Store → Themes → Edit code, then find the <img> tag and add an alt attribute.',
        'In Liquid templates, prefer the image\'s own alt field so merchandisers control it: alt="{{ image.alt | escape }}".',
      );
    } else if (platform === 'woocommerce') {
      steps.push(
        'For product images: Media Library → select image → fill in "Alt text". WooCommerce reads this field directly.',
        'For theme images: edit the template in your child theme and add an alt attribute to each <img>.',
      );
    } else if (platform === 'wix' || platform === 'squarespace' || platform === 'webflow') {
      steps.push(
        'Select the image on the canvas and set alt text in its settings panel — every one of these builders exposes this field per image.',
        'Repeat for images inside repeating or dynamic collections, which are often missed.',
      );
    } else {
      steps.push('Add an alt attribute to every <img> element.', generic(platform));
    }
    steps.push(
      'Describe the image\'s purpose, not its appearance. For a product photo, the product name is usually right.',
      'For purely decorative images use alt="" (empty, not missing) so screen readers skip them.',
      'Never leave alt text as a filename — "IMG_4021.jpg" is treated as a failure, not a pass.',
    );
    return {
      summary: 'Give every meaningful image a text alternative, and mark decorative images as decorative.',
      steps,
      code: {
        language: 'html',
        snippet: [
          '<!-- Meaningful image: describe its purpose -->',
          '<img src="/blue-wool-scarf.jpg" alt="Blue wool scarf, folded">',
          '',
          '<!-- Decorative image: empty alt, so it is skipped -->',
          '<img src="/divider-flourish.svg" alt="">',
          '',
          '<!-- Image used as a link: describe the destination, not the picture -->',
          '<a href="/cart"><img src="/cart-icon.svg" alt="View cart"></a>',
        ].join('\n'),
      },
      effort: 'hours',
    };
  },

  'button-name': (platform) => ({
    summary: 'Give every button an accessible name, including icon-only buttons.',
    steps: [
      'Find each button with no text content — these are almost always icon buttons (search, close, menu, cart).',
      'Add visible text where the design allows it. That is the most robust fix and helps everyone.',
      'Where the design is icon-only, add aria-label describing the action, not the icon.',
      'If the icon is an inline <svg>, also add aria-hidden="true" to it so its contents are not announced twice.',
      generic(platform),
    ],
    code: {
      language: 'html',
      snippet: [
        '<!-- Before: announced only as "button" -->',
        '<button class="cart-toggle"><svg>...</svg></button>',
        '',
        '<!-- After: announced as "Open cart, button" -->',
        '<button class="cart-toggle" aria-label="Open cart">',
        '  <svg aria-hidden="true" focusable="false">...</svg>',
        '</button>',
      ].join('\n'),
    },
    effort: 'minutes',
  }),

  'link-name': (platform) => ({
    summary: 'Give every link discernible text describing where it goes.',
    steps: [
      'Icon-only links (social icons, cart, account, search) are the usual cause.',
      'Add aria-label to the <a> element describing the destination.',
      'Mark any inner <svg> or icon font as aria-hidden="true".',
      'Avoid "click here" and bare URLs — screen reader users often navigate by pulling up a list of links out of context.',
      generic(platform),
    ],
    code: {
      language: 'html',
      snippet: [
        '<a href="https://instagram.com/yourstore" aria-label="Our Instagram profile">',
        '  <svg aria-hidden="true" focusable="false">...</svg>',
        '</a>',
      ].join('\n'),
    },
    effort: 'minutes',
  }),

  label: (platform) => ({
    summary: 'Associate a visible label with every form field.',
    steps: [
      'Pair each input with a <label> whose "for" matches the input\'s "id". This is the most reliable method.',
      'A placeholder is not a label — it disappears when the user types and is inconsistently announced.',
      'Where the design has no room for a visible label, use aria-label, but prefer a visually-hidden <label> so the text still exists.',
      'Check newsletter signups, search boxes, and address fields in particular — these are the fields testers try.',
      generic(platform),
    ],
    code: {
      language: 'html',
      snippet: [
        '<!-- Preferred: explicit label -->',
        '<label for="email">Email address</label>',
        '<input id="email" name="email" type="email" autocomplete="email">',
        '',
        '<!-- Where the design hides the label, keep it for screen readers -->',
        '<label for="q" class="visually-hidden">Search products</label>',
        '<input id="q" name="q" type="search">',
      ].join('\n'),
    },
    effort: 'hours',
  }),

  'select-name': (platform) => ({
    summary: 'Label every dropdown — unlabelled dropdowns are named directly in complaints.',
    steps: [
      'Size, colour and quantity selectors on product pages are the most commonly cited example. Fix those first.',
      'Add a <label for="..."> matching the select\'s id.',
      'If the visible text sits elsewhere on the page, reference it with aria-labelledby instead of duplicating it.',
      generic(platform),
    ],
    code: {
      language: 'html',
      snippet: ['<label for="size">Size</label>', '<select id="size" name="size">', '  <option>Medium</option>', '</select>'].join(
        '\n',
      ),
    },
    effort: 'minutes',
  }),

  'color-contrast': (platform) => ({
    summary: 'Raise text contrast to at least 4.5:1, or 3:1 for large text.',
    steps: [
      'Fix contrast on interactive text first — buttons, links, form errors, checkout copy. That is where a failure blocks a task.',
      'Light grey placeholder and helper text is the most common offender, followed by white text on pastel buttons.',
      'Large text (24px, or 19px bold and above) only needs 3:1, which often saves a brand colour.',
      'Adjust the colour, not the font size, where the colour is not part of the brand.',
      platform === 'squarespace' || platform === 'wix'
        ? 'These builders expose colours through theme or style panels — change them there so the fix applies site-wide.'
        : generic(platform),
    ],
    code: {
      language: 'css',
      snippet: [
        '/* Before: #9b9b9b on white is 2.6:1 — fails */',
        '.help-text { color: #9b9b9b; }',
        '',
        '/* After: #6e6e6e on white is 4.6:1 — passes */',
        '.help-text { color: #6e6e6e; }',
      ].join('\n'),
    },
    effort: 'hours',
  }),

  'html-has-lang': (platform) => ({
    summary: 'Declare the page language on the <html> element.',
    steps: [
      'Add lang="en" (or the correct code) to the <html> tag in your theme layout.',
      'On Shopify this is usually theme.liquid; on WordPress it is the language_attributes() call in header.php.',
      'This is a one-line change that affects every page on the site.',
      generic(platform),
    ],
    code: { language: 'html', snippet: '<html lang="en">' },
    effort: 'minutes',
  }),

  'document-title': (platform) => ({
    summary: 'Give every page a unique, descriptive <title>.',
    steps: [
      'The title is the first thing a screen reader announces on page load, and it is how users tell tabs apart.',
      'Put the distinguishing information first: "Blue Wool Scarf — Your Store", not "Your Store — Blue Wool Scarf".',
      generic(platform),
    ],
    effort: 'minutes',
  }),

  'aria-hidden-focus': (platform) => ({
    summary: 'Never leave focusable elements inside aria-hidden containers.',
    steps: [
      'This usually appears in closed menus, modals and cart drawers that are hidden visually but still reachable by Tab.',
      'Hide the container with display:none or the hidden attribute, which removes it from the focus order too.',
      'Alternatively add tabindex="-1" to every focusable descendant while the container is hidden.',
      'Verify by pressing Tab repeatedly and confirming focus never disappears off-screen.',
      generic(platform),
    ],
    effort: 'developer',
  }),

  'frame-title': (platform) => ({
    summary: 'Title every iframe so its purpose is announced.',
    steps: [
      'Add a title attribute describing the frame\'s content, e.g. title="Customer reviews".',
      'Embedded video, map, review and booking widgets are the usual sources.',
      generic(platform),
    ],
    code: { language: 'html', snippet: '<iframe src="..." title="Product demonstration video"></iframe>' },
    effort: 'minutes',
  }),

  bypass: (platform) => ({
    summary: 'Add a skip link so keyboard users can jump past the navigation.',
    steps: [
      'Add a skip link as the very first focusable element in the <body>.',
      'It should be visually hidden until focused, then clearly visible.',
      'Point it at the id of your main content container, and make sure that container exists.',
      generic(platform),
    ],
    code: {
      language: 'html',
      snippet: [
        '<a class="skip-link" href="#main">Skip to main content</a>',
        '<!-- ...header and navigation... -->',
        '<main id="main" tabindex="-1"> ... </main>',
        '',
        '<style>',
        '  .skip-link { position: absolute; left: -9999px; }',
        '  .skip-link:focus { left: 1rem; top: 1rem; position: fixed; padding: .75rem 1rem;',
        '    background: #fff; color: #000; z-index: 9999; }',
        '</style>',
      ].join('\n'),
    },
    effort: 'minutes',
  }),

  'heading-order': (platform) => ({
    summary: 'Use heading levels in order, without skipping.',
    steps: [
      'Give each page exactly one <h1> describing that page.',
      'Do not skip levels — an <h2> may be followed by <h3>, never straight to <h4>.',
      'Choose heading level by document structure and control the size with CSS, not the other way round.',
      generic(platform),
    ],
    effort: 'hours',
  }),

  'nested-interactive': (platform) => ({
    summary: 'Do not nest interactive controls inside one another.',
    steps: [
      'A button inside a link (or a link inside a button) is announced incoherently and cannot be operated reliably.',
      'Product cards wrapped in a link with an "Add to cart" button inside are the classic case.',
      'Restructure so the controls are siblings rather than nested.',
      generic(platform),
    ],
    effort: 'developer',
  }),

  region: (platform) => ({
    summary: 'Wrap page content in landmark regions.',
    steps: [
      'Use <header>, <nav>, <main>, <aside> and <footer> rather than generic <div> elements.',
      'Every page needs exactly one <main> containing the primary content.',
      generic(platform),
    ],
    effort: 'hours',
  }),

  'meta-viewport': (platform) => ({
    summary: 'Allow users to zoom.',
    steps: [
      'Remove user-scalable=no and any maximum-scale below 5 from the viewport meta tag.',
      'Low-vision users rely on pinch-zoom on mobile; blocking it is a barrier with no upside.',
      generic(platform),
    ],
    code: { language: 'html', snippet: '<meta name="viewport" content="width=device-width, initial-scale=1">' },
    effort: 'minutes',
  }),
};

/** Aliases: rules that share a remediation with another rule. */
const ALIASES: Record<string, string> = {
  'input-image-alt': 'image-alt',
  'area-alt': 'image-alt',
  'role-img-alt': 'image-alt',
  'svg-img-alt': 'image-alt',
  'object-alt': 'image-alt',
  'input-button-name': 'button-name',
  'aria-command-name': 'button-name',
  'aria-input-field-name': 'label',
  'aria-toggle-field-name': 'label',
  'form-field-multiple-labels': 'label',
  'label-title-only': 'label',
  'html-lang-valid': 'html-has-lang',
  'html-xml-lang-mismatch': 'html-has-lang',
  'valid-lang': 'html-has-lang',
  'color-contrast-enhanced': 'color-contrast',
  'landmark-one-main': 'region',
  'page-has-heading-one': 'heading-order',
  'empty-heading': 'heading-order',
  'p-as-heading': 'heading-order',
  'skip-link': 'bypass',
  'meta-viewport-large': 'meta-viewport',
  'frame-focusable-content': 'aria-hidden-focus',
};

export function fixFor(ruleId: string, platform: Platform): FixGuidance | undefined {
  const key = ALIASES[ruleId] ?? ruleId;
  return FIXES[key]?.(platform);
}

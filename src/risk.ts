import type { JourneyStage, RiskTier } from './types.js';

/**
 * Litigation risk model.
 *
 * The premise: a free scanner hands you 300 undifferentiated violations and no
 * order to fix them in. Practically every one of those reports is dominated by
 * low-stakes structural rules, while the handful of barriers that actually get
 * named in demand letters are buried somewhere in the middle. This module
 * encodes which is which.
 *
 * Tier assignments are drawn from the barriers repeatedly named in filed ADA
 * Title III web complaints: missing text alternatives (the most-cited single
 * barrier), keyboard inaccessibility, unlabeled controls and dropdowns,
 * insufficient contrast, screen-reader incompatibility, inaccessible forms,
 * empty buttons, and misused ARIA.
 *
 * IMPORTANT: this is a prioritisation heuristic, not a legal opinion. A low
 * tier means "rarely pleaded", never "safe to ignore" — every violation here
 * is still a real barrier for a real user, and plaintiffs are free to plead
 * anything. See the disclaimer in report.ts.
 */

interface RuleRisk {
  tier: RiskTier;
  /** Why this barrier carries legal weight. Shown verbatim in the report. */
  note: string;
}

/**
 * Barriers that appear by name in the majority of web accessibility
 * complaints. These are what a plaintiff's tester finds in the first ten
 * minutes, and they are what demand letters enumerate.
 */
const CRITICAL: Record<string, string> = {
  'image-alt':
    'Missing alternative text is the single most frequently cited barrier in ADA website complaints. A screen reader announces the filename or nothing at all.',
  'input-image-alt':
    'An image used as a submit button with no alt text leaves the user unable to identify how to submit the form. Routinely pleaded alongside form barriers.',
  'area-alt':
    'Image map regions without alternative text are unusable by screen reader users and are cited as navigation barriers.',
  'role-img-alt':
    'An element declared as an image with no accessible name is announced as an unlabelled graphic. Same failure mode as missing alt text.',
  'svg-img-alt':
    'SVG graphics without accessible names are common in logos and icon buttons, which are exactly the elements testers check first.',
  'object-alt':
    'Embedded objects without text alternatives are inaccessible to assistive technology and are cited as content barriers.',
  'button-name':
    'Empty button elements are explicitly named in complaints. A screen reader announces "button" with no indication of what it does.',
  'input-button-name':
    'An unlabelled submit or reset control blocks task completion, which is the standard courts increasingly expect complaints to demonstrate.',
  'link-name':
    'Links with no discernible text are announced as "link" alone. Icon-only social and cart links are the usual offenders and are commonly pleaded.',
  label:
    'Unlabelled form fields are among the most commonly cited barriers. The user cannot tell what to type, which blocks checkout and contact flows outright.',
  'select-name':
    'Unlabelled dropdown menus are specifically and repeatedly named in ADA web complaints — size and quantity selectors are the classic example.',
  'aria-input-field-name':
    'A custom input with no accessible name is functionally invisible to a screen reader user, blocking form completion.',
  'aria-toggle-field-name':
    'Unlabelled checkboxes and switches block consent, filtering and options selection, all of which sit on transactional paths.',
  'form-field-multiple-labels':
    'Conflicting labels cause assistive technology to announce the wrong prompt, which is pleaded as a form barrier.',
  'frame-title':
    'Untitled frames are announced with no context. Embedded checkout and booking widgets are frequently delivered in frames.',
};

/**
 * Barriers that are commonly pleaded, and the keyboard and screen-reader
 * failures that plaintiff testers probe for directly.
 */
const HIGH: Record<string, string> = {
  'color-contrast':
    'Insufficient contrast is one of the most commonly cited barriers and the easiest for a tester to document with a screenshot.',
  'color-contrast-enhanced':
    'Fails the stricter AAA contrast threshold. Rarely pleaded on its own, but relevant where a higher standard has been asserted publicly.',
  'aria-hidden-focus':
    'Focusable content hidden from assistive technology creates a keyboard trap for screen reader users — a keyboard navigation barrier.',
  'aria-hidden-body':
    'Hiding the document body from assistive technology makes the entire page unusable with a screen reader.',
  'nested-interactive':
    'Nested controls break keyboard navigation and are announced incoherently, a documented screen-reader incompatibility.',
  'scrollable-region-focusable':
    'A scrollable region that cannot receive keyboard focus makes its content unreachable without a mouse.',
  'aria-required-attr':
    'ARIA roles missing their required attributes are announced incorrectly. Misused ARIA is named as a barrier category in complaints.',
  'aria-required-children':
    'Malformed ARIA composite widgets (menus, listboxes, tabs) are announced incorrectly and often cannot be operated by keyboard.',
  'aria-required-parent':
    'Orphaned ARIA children break the widget contract, leaving navigation and menu components unusable.',
  'aria-valid-attr-value':
    'Invalid ARIA values commonly point at nonexistent elements, so labels and descriptions silently never reach the user.',
  'aria-valid-attr': 'Invalid ARIA attributes are ignored, so the intended accessible name or state is never announced.',
  'aria-roles': 'Invalid ARIA roles cause elements to be announced as the wrong kind of control, or not at all.',
  'aria-allowed-attr': 'ARIA attributes not permitted on their role are dropped, losing state information such as expanded or selected.',
  'aria-allowed-role': 'A role not permitted on an element produces inconsistent announcements across screen readers.',
  'aria-command-name': 'Unlabelled ARIA buttons and links are announced with no purpose, the same failure as an empty button.',
  'aria-tooltip-name': 'An unlabelled tooltip conveys no information to assistive technology.',
  'aria-progressbar-name': 'Unlabelled progress indicators leave the user unaware of checkout or upload state.',
  'aria-meter-name': 'Unlabelled meters convey no value to assistive technology.',
  'aria-dialog-name':
    'Unlabelled modal dialogs are a significant barrier — age gates, cookie banners and cart drawers frequently block the page until dismissed.',
  'html-has-lang':
    'A missing language declaration causes screen readers to read content in the wrong accent or phonetics, cited as screen-reader incompatibility.',
  'html-lang-valid': 'An invalid language code has the same effect as a missing one — the wrong pronunciation rules are applied.',
  'html-xml-lang-mismatch': 'Conflicting language declarations produce unpredictable screen reader pronunciation.',
  'valid-lang': 'Invalid inline language codes cause passages to be read with the wrong pronunciation rules.',
  'video-caption': 'Uncaptioned video is a well-established barrier for deaf and hard-of-hearing users and is directly pleaded.',
  'audio-caption': 'Audio content without a text alternative is inaccessible to deaf and hard-of-hearing users.',
  'server-side-image-map': 'Server-side image maps cannot be operated by keyboard at all.',
  'meta-refresh': 'Automatic page refreshes interrupt screen reader users mid-sentence and can make a page impossible to read.',
  'meta-refresh-no-exceptions': 'Timed refreshes that cannot be disabled block users who need more time.',
  blink: 'Blinking content can trigger seizures and is prohibited outright by WCAG.',
  marquee: 'Moving content that cannot be paused is both a cognitive barrier and a screen-reader problem.',
  'th-has-data-cells': 'Broken table header relationships make data tables unreadable in screen reader table navigation mode.',
  'td-headers-attr': 'Incorrect header references scramble the announced context of every cell.',
  'no-autoplay-audio': 'Autoplaying audio masks screen reader speech, making the page unusable until the user finds the stop control.',
};

/**
 * Real barriers that are seldom pleaded on their own. Worth fixing; not worth
 * fixing before the tiers above.
 */
const MODERATE: Record<string, string> = {
  'document-title': 'A missing page title leaves screen reader users unable to distinguish tabs or orient after navigation.',
  'duplicate-id-active': 'Duplicate IDs on interactive elements break label associations, sometimes silently.',
  'duplicate-id-aria': 'Duplicate IDs referenced by ARIA cause the wrong element to be announced as the label.',
  'heading-order': 'Skipped heading levels disrupt the outline screen reader users navigate by.',
  'empty-heading': 'Empty headings add meaningless stops to heading navigation.',
  'page-has-heading-one': 'A missing top-level heading removes the main entry point for heading-based navigation.',
  bypass: 'No skip link or landmark forces keyboard users through the entire navigation on every page load.',
  'landmark-one-main': 'Without a main landmark, users cannot jump directly to page content.',
  'landmark-unique': 'Indistinguishable landmarks make landmark navigation ambiguous.',
  region: 'Content outside landmarks is skipped by users navigating structurally.',
  list: 'Malformed lists lose the item count screen readers announce.',
  listitem: 'List items outside a list container lose their positional context.',
  'definition-list': 'Malformed definition lists break term and description pairing.',
  dlitem: 'Definition list items outside a list lose their association.',
  'autocomplete-valid': 'Invalid autocomplete tokens defeat autofill, which many users with motor and cognitive disabilities rely on.',
  'meta-viewport': 'Blocking zoom prevents low-vision users from enlarging text. Increasingly noted by testers on mobile.',
  'meta-viewport-large': 'Restrictive zoom limits hinder low-vision users.',
  'label-title-only': 'A title attribute alone is an unreliable label — it is not announced consistently and never appears on touch.',
  'avoid-inline-spacing': 'Inline spacing set with !important cannot be overridden by user stylesheets.',
  'p-as-heading': 'Paragraphs styled to look like headings are invisible to heading navigation.',
  tabindex: 'Positive tabindex values create a focus order that diverges from the visual order, confusing keyboard users.',
  'focus-order-semantics': 'Elements in the focus order without appropriate roles are announced without their purpose.',
  accesskeys: 'Duplicate access keys conflict with assistive technology shortcuts.',
  'table-fake-caption': 'A caption that is not marked up as one is not announced as the table description.',
  'td-has-header': 'Data cells without headers lose context in large tables.',
  'scope-attr-valid': 'Invalid scope values break header-to-cell association.',
  'aria-text': 'Misapplied role=text can hide nested interactive content.',
  'summary-name': 'An unlabelled disclosure summary gives no indication of what it expands.',
  'frame-focusable-content': 'Focusable content in a frame excluded from assistive technology becomes a keyboard trap.',
};

/**
 * Best-practice and edge-case rules. Included for completeness so the report
 * is a full account of what was found, but scored near zero so they never
 * crowd out the barriers that matter.
 */
const LOW: Record<string, string> = {
  'duplicate-id': 'Duplicate IDs on non-interactive elements are a code-hygiene issue with limited direct user impact.',
  'image-redundant-alt': 'Alt text duplicating adjacent visible text causes the same phrase to be announced twice.',
  'identical-links-same-purpose': 'Links with identical text pointing to different destinations are ambiguous out of context.',
  'presentation-role-conflict': 'Conflicting presentation roles produce inconsistent announcements across screen readers.',
  'empty-table-header': 'Empty header cells give no context for their column or row.',
  'frame-tested': 'A frame could not be tested, so its contents are unknown rather than known-good.',
  'css-orientation-lock': 'Locking orientation blocks users with fixed-mounted devices.',
  'target-size': 'Small touch targets are difficult for users with motor impairments. A newer criterion, not yet common in pleadings.',
  'link-in-text-block': 'Links distinguished only by colour are hard to identify for colour-blind users.',
  'skip-link': 'A skip link pointing at a missing target does not work.',
  'aria-treeitem-name': 'Unlabelled tree items are announced without purpose.',
  'aria-braille-equivalent': 'Braille attributes without a text equivalent are inconsistently supported.',
  'aria-deprecated-role': 'Deprecated roles may lose support in future assistive technology releases.',
  'aria-conditional-attr': 'Conditionally invalid ARIA attributes may be ignored.',
  'aria-prohibited-attr': 'Prohibited ARIA attributes are ignored, so the intended name is never announced.',
  'landmark-complementary-is-top-level': 'Nested complementary landmarks are harder to locate.',
  'landmark-banner-is-top-level': 'A nested banner landmark may be missed in landmark navigation.',
  'landmark-contentinfo-is-top-level': 'A nested contentinfo landmark may be missed in landmark navigation.',
  'landmark-main-is-top-level': 'A nested main landmark is ambiguous.',
  'landmark-no-duplicate-banner': 'Multiple banner landmarks are ambiguous to navigate.',
  'landmark-no-duplicate-contentinfo': 'Multiple contentinfo landmarks are ambiguous to navigate.',
  'landmark-no-duplicate-main': 'Multiple main landmarks defeat the purpose of the landmark.',
};

const RULE_RISK: Record<string, RuleRisk> = {
  ...mapTier(CRITICAL, 'critical'),
  ...mapTier(HIGH, 'high'),
  ...mapTier(MODERATE, 'moderate'),
  ...mapTier(LOW, 'low'),
};

function mapTier(source: Record<string, string>, tier: RiskTier): Record<string, RuleRisk> {
  return Object.fromEntries(Object.entries(source).map(([id, note]) => [id, { tier, note }]));
}

/**
 * axe ships new rules regularly, so an unmapped rule is expected rather than
 * exceptional. Fall back to axe's own impact rating, deliberately one step
 * conservative: we would rather under-rank an unknown rule than have it
 * displace a barrier we know gets pleaded.
 */
function fallbackRisk(axeImpact: string): RuleRisk {
  const note =
    'Not yet mapped to observed litigation patterns; ranked from its accessibility impact rating. Treat as a real barrier pending review.';
  switch (axeImpact) {
    case 'critical':
      return { tier: 'high', note };
    case 'serious':
      return { tier: 'moderate', note };
    default:
      return { tier: 'low', note };
  }
}

export function riskForRule(ruleId: string, axeImpact: string): RuleRisk {
  return RULE_RISK[ruleId] ?? fallbackRisk(axeImpact);
}

/** True when we have an explicit mapping, as opposed to an impact-based guess. */
export function isMappedRule(ruleId: string): boolean {
  return ruleId in RULE_RISK;
}

/** Base points for one instance of a barrier at each tier. */
const TIER_WEIGHT: Record<RiskTier, number> = {
  critical: 100,
  high: 40,
  moderate: 10,
  low: 2,
};

/**
 * How much a barrier's location amplifies its exposure.
 *
 * A broken checkout button is the barrier a complaint is built around; the
 * same failure in a footer is a footnote. Weighting by journey stage is what
 * makes the ranking actionable for a store owner with limited hours.
 */
const STAGE_WEIGHT: Record<JourneyStage, number> = {
  checkout: 2.0,
  cart: 1.8,
  product: 1.5,
  contact: 1.4,
  collection: 1.3,
  home: 1.2,
  other: 1.0,
};

export function stageWeight(stage: JourneyStage): number {
  return STAGE_WEIGHT[stage];
}

/**
 * Score one barrier.
 *
 * Instance count scales sub-linearly: 200 missing alt attributes is materially
 * worse than one, but it is not 200 times worse — it is one systemic template
 * bug with one fix. Linear scaling would let a single repeated rule swamp the
 * entire report, which is precisely the failure mode of the free scanners.
 */
export function scoreFinding(tier: RiskTier, instanceCount: number, worstStage: JourneyStage): number {
  if (instanceCount <= 0) return 0;
  const volume = 1 + Math.log2(instanceCount);
  return TIER_WEIGHT[tier] * volume * STAGE_WEIGHT[worstStage];
}

/**
 * Compress the raw total into a 0-100 "exposure score".
 *
 * The curve is saturating: a site with ten critical barriers and a site with
 * eighty are both in serious trouble, and the difference between them is not
 * decision-relevant. What matters is separating "clean" from "a tester would
 * find something in five minutes", so resolution is concentrated at the low
 * end. 600 raw points lands at roughly 63 — that is about six critical
 * barriers on a product page.
 */
export function exposureScore(rawTotal: number): number {
  if (rawTotal <= 0) return 0;
  const HALF_LIFE = 600;
  return Math.round(100 * (1 - Math.exp(-rawTotal / HALF_LIFE)));
}

/** Plain-language band for the exposure score. Deliberately not a grade. */
export function exposureBand(score: number): { label: string; meaning: string } {
  if (score >= 70) {
    return {
      label: 'Severe',
      meaning:
        'Multiple barriers of the kind named directly in demand letters, on pages that matter. A tester would find these quickly.',
    };
  }
  if (score >= 40) {
    return {
      label: 'Elevated',
      meaning: 'Several commonly cited barriers present. These are the ones to fix first.',
    };
  }
  if (score >= 15) {
    return {
      label: 'Moderate',
      meaning: 'Some real barriers, but few of the most-cited kinds. Worth clearing before they multiply.',
    };
  }
  if (score > 0) {
    return {
      label: 'Low',
      meaning: 'Automated checks found little. This is a good position — but see the coverage limits below.',
    };
  }
  return {
    label: 'None detected',
    meaning: 'No automated violations found. This does NOT mean the site is accessible — see the coverage limits below.',
  };
}

/** Infer where a URL sits in a purchase flow, from its path. */
export function classifyUrl(rawUrl: string): JourneyStage {
  let path: string;
  try {
    const u = new URL(rawUrl);
    path = `${u.pathname}${u.search}`.toLowerCase();
    if (u.pathname === '/' || u.pathname === '') return 'home';
  } catch {
    path = rawUrl.toLowerCase();
  }

  // Ordered by specificity: /checkout wins over a generic /cart substring.
  const patterns: Array<[JourneyStage, RegExp]> = [
    ['checkout', /checkout|payment|billing|place-?order|thank-?you|order-confirm/],
    ['cart', /\/cart|basket|bag\b/],
    ['product', /\/products?\/|\/item\/|\/p\/|\/shop\/[^/]+\/[^/]+/],
    ['collection', /\/collections?\/|\/category\/|\/categories\/|\/shop\/?$|\/store\/?$|\/catalog/],
    ['contact', /contact|support|help|customer-?service|returns?|refund|accessibility/],
  ];

  for (const [stage, re] of patterns) {
    if (re.test(path)) return stage;
  }
  return 'other';
}

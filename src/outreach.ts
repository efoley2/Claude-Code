import { scoreFinding, stageWeight } from './risk.js';
import type { AggregatedFinding, JourneyStage, Platform, ScanReport } from './types.js';

/**
 * Raw material for a personalised cold email.
 *
 * This module deliberately stops short of writing the email. Recipients
 * pattern-match AI-written outreach within a sentence or two and reply rates
 * collapse when they do, so the sentences around the findings have to be the
 * operator's own. What is genuinely hard to write by hand — picking the three
 * most persuasive findings out of forty and phrasing each as something a shop
 * owner recognises on sight — is what gets generated here.
 *
 * The honesty constraint from report.ts applies with more force, not less:
 * a report is read by someone who asked for it, an email is not. Nothing this
 * module emits may state or imply compliance, protection or certification, and
 * nothing may predict that a particular business will be sued. Bullets are
 * observations about markup and nothing else. `test/outreach.test.ts` asserts
 * this over every phrasing in the table below.
 */

/** How a rule's failures are described to a non-technical store owner. */
interface Phrasing {
  /** Countable thing the reader can picture, singular. */
  noun?: string;
  /** Irregular plural, where appending "s" would be wrong. */
  plural?: string;
  /** Predicate completing "<n> <nouns> [<where>] ___". */
  problem?: string;
  /**
   * Page-level barriers have no meaningful element count — "1 html element
   * with no lang attribute" is technically true and rhetorically useless — so
   * they are stated as a whole sentence instead and score lower for it.
   */
  statement?: string;
}

/**
 * Countable, visible barriers first.
 *
 * "14 product images with no alt text" is checkable by the recipient in ten
 * seconds and is why the email gets a reply. "Landmark regions are missing" is
 * true, unfalsifiable to a layperson, and reads like every other scanner spam
 * they already delete.
 */
const PHRASING: Record<string, Phrasing> = {
  'image-alt': { noun: 'image', problem: 'with no alt text' },
  'input-image-alt': { noun: 'image button', problem: 'with no alt text' },
  'area-alt': { noun: 'image map area', problem: 'with no alt text' },
  'role-img-alt': { noun: 'graphic', problem: 'with no accessible name' },
  'svg-img-alt': { noun: 'SVG icon', problem: 'with no accessible name' },
  'object-alt': { noun: 'embedded object', problem: 'with no text alternative' },
  'button-name': { noun: 'button', problem: 'with no readable label' },
  'input-button-name': { noun: 'submit button', problem: 'with no label' },
  'link-name': { noun: 'link', problem: 'with no readable text' },
  label: { noun: 'form field', problem: 'with no label' },
  'select-name': { noun: 'dropdown menu', problem: 'with no label' },
  'aria-input-field-name': { noun: 'custom input', problem: 'with no accessible name' },
  'aria-toggle-field-name': {
    noun: 'checkbox or switch',
    plural: 'checkboxes and switches',
    problem: 'with no label',
  },
  'form-field-multiple-labels': { noun: 'form field', problem: 'with two conflicting labels' },
  'frame-title': { noun: 'embedded frame', problem: 'with no title' },

  'color-contrast': { noun: 'piece of text', plural: 'pieces of text', problem: 'below the minimum contrast ratio' },
  'color-contrast-enhanced': {
    noun: 'piece of text',
    plural: 'pieces of text',
    problem: 'below the stricter AAA contrast ratio',
  },
  'aria-hidden-focus': { noun: 'focusable element', problem: 'hidden from screen readers' },
  'aria-hidden-body': { statement: 'The whole page is hidden from screen readers by an aria-hidden attribute' },
  'nested-interactive': { noun: 'control', problem: 'nested inside another control' },
  'scrollable-region-focusable': { noun: 'scrollable area', problem: 'unreachable by keyboard' },
  'aria-required-attr': { noun: 'ARIA widget', problem: 'missing attributes it needs to be announced correctly' },
  'aria-required-children': { noun: 'menu or listbox', plural: 'menus and listboxes', problem: 'built with the wrong child elements' },
  'aria-required-parent': { noun: 'ARIA element', problem: 'outside the container its role requires' },
  'aria-valid-attr-value': { noun: 'ARIA reference', problem: 'pointing at an element that is not on the page' },
  'aria-valid-attr': { noun: 'element', problem: 'with an ARIA attribute screen readers ignore' },
  'aria-roles': { noun: 'element', problem: 'with an ARIA role that is not valid' },
  'aria-allowed-attr': { noun: 'element', problem: 'with an ARIA attribute its role does not allow' },
  'aria-allowed-role': { noun: 'element', problem: 'with an ARIA role it is not allowed to have' },
  'aria-command-name': { noun: 'ARIA button', problem: 'with no accessible name' },
  'aria-tooltip-name': { noun: 'tooltip', problem: 'with no accessible name' },
  'aria-progressbar-name': { noun: 'progress indicator', problem: 'with no label' },
  'aria-meter-name': { noun: 'meter', problem: 'with no label' },
  'aria-dialog-name': { noun: 'pop-up dialog', problem: 'with no accessible name' },
  'html-has-lang': { statement: 'Your pages do not declare a language, so screen readers read them with the wrong pronunciation' },
  'html-lang-valid': { statement: 'Your pages declare a language code that is not valid, so screen readers fall back to the wrong pronunciation' },
  'html-xml-lang-mismatch': { statement: 'Your pages declare two different languages at once' },
  'valid-lang': { noun: 'passage', problem: 'marked with a language code that is not valid' },
  'video-caption': { noun: 'video', problem: 'with no captions' },
  'audio-caption': { noun: 'audio clip', problem: 'with no text alternative' },
  'no-autoplay-audio': { statement: 'Audio starts on its own and talks over a screen reader' },
  'server-side-image-map': { noun: 'image map', problem: 'that a keyboard cannot operate' },
  'meta-refresh': { statement: 'A page refreshes itself on a timer, which interrupts a screen reader mid-sentence' },
  'meta-refresh-no-exceptions': { statement: 'A page refreshes itself on a timer that cannot be turned off' },
  blink: { noun: 'element', problem: 'blinking on and off' },
  marquee: { noun: 'scrolling marquee', problem: 'that cannot be paused' },
  'th-has-data-cells': { noun: 'table header', problem: 'not connected to any data' },
  'td-headers-attr': { noun: 'table cell', problem: 'pointing at a header that does not exist' },

  'document-title': { statement: 'A page has no title, so it is announced only by its address' },
  'duplicate-id-active': { noun: 'control', problem: 'sharing an id with another element, which breaks its label' },
  'heading-order': { noun: 'heading', problem: 'that skips a level' },
  'empty-heading': { noun: 'heading', problem: 'with no text' },
  'page-has-heading-one': { statement: 'A page has no main heading to navigate from' },
  bypass: { statement: 'There is no skip link, so a keyboard user tabs through the whole menu on every page' },
  'meta-viewport': { statement: 'Pinch-zoom is switched off, so text cannot be enlarged on a phone' },
  'label-title-only': { noun: 'form field', problem: 'labelled only by a tooltip, which never appears on touch devices' },
  tabindex: { noun: 'element', problem: 'with a tabindex that puts it out of order for keyboard users' },
  list: { noun: 'list', problem: 'built so the item count is not announced' },
  region: { statement: 'Parts of the page sit outside any landmark, so structural navigation skips them' },
};

/**
 * Every rule with hand-written phrasing.
 *
 * Exported so the honesty test can assert over the whole table rather than
 * over whichever entries a fixture scan happens to trigger — a bad phrase
 * added here must fail the build even if no test site exhibits that barrier.
 */
export function phrasedRuleIds(): string[] {
  return Object.keys(PHRASING);
}

/** Where the barrier sits, phrased for the owner rather than as a URL. */
const LOCATOR: Record<JourneyStage, string> = {
  checkout: 'in your checkout',
  cart: 'in your cart',
  product: 'on your product pages',
  collection: 'on your category pages',
  contact: 'on your contact page',
  home: 'on your home page',
  other: '',
};

/**
 * How much the phrasing style is worth in the selection ranking.
 *
 * A countable barrier the reader can go and look at outranks an abstract one
 * even when the abstract one scores higher for exposure, because the email's
 * whole job is to be verifiable in ten seconds. Exposure ranking is the
 * report's problem; this is a different question.
 */
const CONCRETENESS: Record<'countable' | 'statement' | 'unmapped', number> = {
  countable: 1,
  statement: 0.55,
  unmapped: 0.25,
};

/** One finding, chosen for outreach and phrased for a human. */
export interface OutreachFinding {
  ruleId: string;
  tier: AggregatedFinding['tier'];
  /** Plain-English bullet, ready to paste into an email and edit. */
  bullet: string;
  instanceCount: number;
  /** Highest-weight journey stage this barrier appears on. */
  stage: JourneyStage;
  /** A page where the recipient can verify the claim themselves. */
  url: string;
  /** Ranking used to pick this over the others. Not shown to anyone. */
  selectionScore: number;
}

export interface OutreachQualification {
  qualified: boolean;
  /** Empty when qualified; otherwise why this domain must not be emailed. */
  reason: string;
}

export interface OutreachBrief {
  site: string;
  platform: Platform;
  exposureScore: number;
  qualification: OutreachQualification;
  findings: OutreachFinding[];
  /** Just the bullet strings, in the order they should appear in the email. */
  bullets: string[];
}

function pluralise(count: number, phrasing: Phrasing): string {
  const noun = phrasing.noun ?? 'element';
  if (count === 1) return noun;
  if (phrasing.plural) return phrasing.plural;
  return /(s|x|z|ch|sh)$/.test(noun) ? `${noun}es` : `${noun}s`;
}

/** The stage the barrier is worst on, which is where the report scored it too. */
function worstStage(finding: AggregatedFinding): { stage: JourneyStage; url: string; pageCount: number } {
  const best = finding.pages.reduce((worst, p) => (stageWeight(p.stage) > stageWeight(worst.stage) ? p : worst), {
    stage: 'other' as JourneyStage,
    url: '',
    instanceCount: 0,
  });
  const stage = best.stage;
  return {
    stage,
    url: best.url || (finding.pages[0]?.url ?? ''),
    pageCount: finding.pages.filter((p) => p.stage === stage).length,
  };
}

function locatorFor(stage: JourneyStage, pageCount: number): string {
  const locator = LOCATOR[stage];
  // "on your product pages" is a lie if we only reached one of them.
  if (pageCount === 1 && (stage === 'product' || stage === 'collection')) return locator.replace(/pages$/, 'page');
  return locator;
}

/**
 * Phrase one finding.
 *
 * Unmapped rules still get a bullet rather than being dropped, because axe adds
 * rules faster than this table is maintained — but the fallback quotes axe's
 * own wording instead of inventing a plain-English claim about someone's site.
 */
function phrase(finding: AggregatedFinding): { bullet: string; style: keyof typeof CONCRETENESS } {
  const { stage, pageCount } = worstStage(finding);
  const phrasing = PHRASING[finding.ruleId];

  if (phrasing?.statement) return { bullet: phrasing.statement, style: 'statement' };

  if (phrasing?.noun && phrasing.problem) {
    const locator = locatorFor(stage, pageCount);
    const parts = [
      String(finding.instanceCount),
      pluralise(finding.instanceCount, phrasing),
      locator,
      phrasing.problem,
    ].filter(Boolean);
    return { bullet: parts.join(' '), style: 'countable' };
  }

  const noun = finding.instanceCount === 1 ? 'element' : 'elements';
  return {
    bullet: `${finding.instanceCount} ${noun} flagged by the "${finding.description}" check`,
    style: 'unmapped',
  };
}

/**
 * Rank findings for outreach and phrase the top few.
 *
 * The exposure score answers "what should this store fix first". This answers
 * "which three facts will make a stranger reply", which is the same signal
 * bent by one extra term: how concrete the barrier is to describe.
 */
export function outreachFindings(report: ScanReport, limit = 3): OutreachFinding[] {
  const ranked = report.findings
    .filter((f) => f.instanceCount > 0)
    .map((finding) => {
      const { stage, url } = worstStage(finding);
      const { bullet, style } = phrase(finding);
      return {
        ruleId: finding.ruleId,
        tier: finding.tier,
        bullet,
        instanceCount: finding.instanceCount,
        stage,
        url,
        selectionScore: scoreFinding(finding.tier, finding.instanceCount, stage) * CONCRETENESS[style],
      };
    })
    .sort((a, b) => b.selectionScore - a.selectionScore);

  return ranked.slice(0, Math.max(0, limit));
}

/** Convenience wrapper: the bullets alone, ready to paste. */
export function outreachBullets(report: ScanReport, limit = 3): string[] {
  return outreachFindings(report, limit).map((f) => f.bullet);
}

/**
 * Decide whether this domain may be contacted at all.
 *
 * PLAN.md §5: never email someone whose site came back clean. The bar here is
 * one rung higher than "not literally zero findings" — a store whose only
 * problems are landmark and heading-order warnings has nothing an owner would
 * recognise as a problem, and an email about it is indistinguishable from the
 * scanner spam this business is positioned against.
 */
export function qualifyForOutreach(report: ScanReport): OutreachQualification {
  if (report.findings.length === 0) {
    return { qualified: false, reason: 'clean scan — no automated violations found' };
  }
  const substantive = report.findings.filter((f) => f.tier === 'critical' || f.tier === 'high');
  if (substantive.length === 0) {
    return { qualified: false, reason: 'no critical or high-tier findings — nothing worth an email' };
  }
  if (outreachFindings(report, 1).length === 0) {
    return { qualified: false, reason: 'no finding could be stated as a fact about the site' };
  }
  return { qualified: true, reason: '' };
}

export function buildOutreach(report: ScanReport, limit = 3): OutreachBrief {
  const findings = outreachFindings(report, limit);
  return {
    site: report.site,
    platform: report.platform,
    exposureScore: report.exposureScore,
    qualification: qualifyForOutreach(report),
    findings,
    bullets: findings.map((f) => f.bullet),
  };
}

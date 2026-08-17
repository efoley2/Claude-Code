/**
 * Shared types for the Curbcut scanner.
 */

/**
 * Litigation risk tiers.
 *
 * These are NOT the same as axe-core's `impact` field. axe rates how much a
 * violation harms a user; we rate how often the barrier shows up as a named
 * allegation in real ADA Title III web complaints. The two correlate but
 * diverge sharply in places — `region` (no landmarks) is a genuine usability
 * problem that axe flags as "moderate", but it is almost never pleaded on its
 * own. Missing alt text is the single most-cited barrier in filed complaints.
 */
export type RiskTier = 'critical' | 'high' | 'moderate' | 'low';

/**
 * Where in a purchase flow a page sits.
 *
 * Courts have grown impatient with boilerplate complaints that do not tie an
 * alleged barrier to a real attempt to complete a task. A contrast failure in
 * a footer is not the same exposure as one on the checkout button, so page
 * position is a first-class input to scoring rather than a display detail.
 */
export type JourneyStage =
  | 'checkout'
  | 'cart'
  | 'product'
  | 'collection'
  | 'contact'
  | 'home'
  | 'other';

export type Platform =
  | 'shopify'
  | 'woocommerce'
  | 'wix'
  | 'squarespace'
  | 'bigcommerce'
  | 'webflow'
  | 'unknown';

/** A single element that failed a rule. */
export interface FindingInstance {
  /** CSS selector path to the offending element. */
  selector: string;
  /** Trimmed outerHTML, for the report so a developer can find it. */
  html: string;
  /** axe's human-readable explanation of what specifically failed. */
  failureSummary: string;
}

/** One rule violation on one page, with all its failing elements. */
export interface Finding {
  ruleId: string;
  /** axe's own description of the rule. */
  description: string;
  helpUrl: string;
  /** axe's accessibility impact rating: minor | moderate | serious | critical. */
  axeImpact: string;
  /** WCAG success criteria this rule maps to, e.g. ["1.1.1"]. */
  wcagCriteria: string[];
  tier: RiskTier;
  /** Why this specific barrier carries legal weight, in plain language. */
  litigationNote: string;
  instances: FindingInstance[];
}

/** Result of scanning one URL. */
export interface PageScan {
  url: string;
  title: string;
  stage: JourneyStage;
  findings: Finding[];
  /** Non-fatal problems, e.g. the page redirected or partially failed to load. */
  warnings: string[];
}

/** A finding rolled up across every page it appears on. */
export interface AggregatedFinding {
  ruleId: string;
  description: string;
  helpUrl: string;
  tier: RiskTier;
  litigationNote: string;
  wcagCriteria: string[];
  /** Total failing elements across all pages. */
  instanceCount: number;
  /** Pages where this rule failed, with the worst-case journey stage first. */
  pages: Array<{ url: string; stage: JourneyStage; instanceCount: number }>;
  /** Contribution to the overall exposure score. */
  score: number;
  /** Platform-specific remediation guidance, if we have any. */
  fix?: FixGuidance;
  /** A representative failing element, for the report. */
  example?: FindingInstance;
}

export interface FixGuidance {
  /** One-line statement of what to change. */
  summary: string;
  /** Concrete steps, platform-specific where possible. */
  steps: string[];
  /** Optional copy-pasteable code. */
  code?: { language: string; snippet: string };
  /** Rough effort so the owner can plan, not a quote. */
  effort: 'minutes' | 'hours' | 'developer';
}

export interface ScanReport {
  site: string;
  scannedAt: string;
  platform: Platform;
  pagesScanned: PageScan[];
  findings: AggregatedFinding[];
  /** 0-100. Higher means more exposure. See scoring notes in risk.ts. */
  exposureScore: number;
  summary: {
    critical: number;
    high: number;
    moderate: number;
    low: number;
    totalInstances: number;
  };
  /** Rules that ran and passed — evidence of what was actually checked. */
  passedRuleCount: number;
  /** Rules axe flagged as needing human review. */
  incompleteRuleCount: number;
}

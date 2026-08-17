import type { AggregatedFinding, RiskTier, ScanReport } from './types.js';
import { exposureBand } from './risk.js';
import { PLATFORM_LABEL } from './platform.js';

/**
 * Report generation.
 *
 * The single most important constraint in this file: the report must never
 * state or imply that the site is compliant, accessible, or protected. The FTC
 * fined a major vendor in this market $1M for exactly that claim, and roughly
 * 38% of businesses sued in 2025 had already bought a product that told them
 * they were covered. Any honest tool in this space has to lead with what it
 * cannot see, and the coverage limits are therefore rendered above the findings
 * rather than buried in a footer.
 */

const TIER_LABEL: Record<RiskTier, string> = {
  critical: 'Most-cited barrier',
  high: 'Commonly cited',
  moderate: 'Real barrier, rarely pleaded',
  low: 'Best practice',
};

const TIER_ORDER: RiskTier[] = ['critical', 'high', 'moderate', 'low'];

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function renderFix(f: AggregatedFinding): string {
  if (!f.fix) {
    return `<p class="no-fix">No platform-specific guidance yet for this rule. See <a href="${escapeHtml(
      f.helpUrl,
    )}" rel="noopener">the rule reference</a>.</p>`;
  }
  const steps = f.fix.steps.map((s) => `<li>${escapeHtml(s)}</li>`).join('');
  const code = f.fix.code
    ? `<pre class="code"><code>${escapeHtml(f.fix.code.snippet)}</code></pre>`
    : '';
  return `
    <div class="fix">
      <div class="fix-head">
        <strong>How to fix</strong>
        <span class="effort effort-${f.fix.effort}">${escapeHtml(effortLabel(f.fix.effort))}</span>
      </div>
      <p class="fix-summary">${escapeHtml(f.fix.summary)}</p>
      <ol>${steps}</ol>
      ${code}
    </div>`;
}

function effortLabel(effort: string): string {
  switch (effort) {
    case 'minutes':
      return 'Minutes';
    case 'hours':
      return 'An hour or two';
    default:
      return 'Needs a developer';
  }
}

function renderFinding(f: AggregatedFinding, index: number): string {
  const pages = f.pages
    .map(
      (p) =>
        `<li><span class="stage stage-${p.stage}">${escapeHtml(p.stage)}</span> <a href="${escapeHtml(
          p.url,
        )}" rel="noopener">${escapeHtml(p.url)}</a> <span class="muted">— ${p.instanceCount} ${
          p.instanceCount === 1 ? 'element' : 'elements'
        }</span></li>`,
    )
    .join('');

  const wcag = f.wcagCriteria.length
    ? `<span class="wcag">WCAG ${f.wcagCriteria.map(escapeHtml).join(', ')}</span>`
    : '';

  const example = f.example
    ? `<details class="example">
         <summary>Example failing element</summary>
         <p class="muted selector">${escapeHtml(f.example.selector)}</p>
         <pre class="code"><code>${escapeHtml(f.example.html)}</code></pre>
       </details>`
    : '';

  return `
  <article class="finding tier-${f.tier}" id="finding-${index + 1}">
    <header class="finding-head">
      <div class="rank">${index + 1}</div>
      <div class="finding-title">
        <h3>${escapeHtml(f.description)}</h3>
        <div class="badges">
          <span class="tier tier-badge-${f.tier}">${escapeHtml(TIER_LABEL[f.tier])}</span>
          ${wcag}
          <span class="muted">${f.instanceCount} ${f.instanceCount === 1 ? 'element' : 'elements'}</span>
          <span class="muted rule-id">${escapeHtml(f.ruleId)}</span>
        </div>
      </div>
    </header>
    <p class="why"><strong>Why this matters:</strong> ${escapeHtml(f.litigationNote)}</p>
    <details class="pages">
      <summary>Found on ${f.pages.length} ${f.pages.length === 1 ? 'page' : 'pages'}</summary>
      <ul>${pages}</ul>
    </details>
    ${example}
    ${renderFix(f)}
  </article>`;
}

export function renderHtmlReport(report: ScanReport): string {
  const band = exposureBand(report.exposureScore);
  const host = safeHost(report.site);

  const critical = report.findings.filter((f) => f.tier === 'critical');
  const high = report.findings.filter((f) => f.tier === 'high');
  const priority = [...critical, ...high];

  const findingsHtml = report.findings.length
    ? TIER_ORDER.map((tier) => {
        const group = report.findings.filter((f) => f.tier === tier);
        if (!group.length) return '';
        const startIndex = report.findings.findIndex((f) => f.tier === tier);
        return `
        <section class="tier-group">
          <h2 class="tier-heading tier-heading-${tier}">${escapeHtml(TIER_LABEL[tier])} <span class="muted">(${
            group.length
          })</span></h2>
          ${group.map((f, i) => renderFinding(f, startIndex + i)).join('')}
        </section>`;
      }).join('')
    : `<p class="empty">No automated violations were detected. Read the coverage limits above carefully — this is not the same as being accessible.</p>`;

  const pagesList = report.pagesScanned
    .map(
      (p) =>
        `<li><span class="stage stage-${p.stage}">${escapeHtml(p.stage)}</span> <a href="${escapeHtml(
          p.url,
        )}" rel="noopener">${escapeHtml(p.url)}</a>${
          p.warnings.length ? ` <span class="warn">${escapeHtml(p.warnings.join(' '))}</span>` : ''
        }</li>`,
    )
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Accessibility findings — ${escapeHtml(host)}</title>
<style>
  :root {
    --bg: #ffffff; --surface: #f7f7f5; --surface-2: #efeeea;
    --text: #1a1a18; --muted: #6b6b66; --border: #dcdbd5;
    --critical: #b3261e; --high: #b45309; --moderate: #3f6212; --low: #52525b;
    --accent: #1d4ed8; --warn-bg: #fff7ed; --warn-border: #fdba74;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --bg: #14140f; --surface: #1e1e1a; --surface-2: #262622;
      --text: #ecebe4; --muted: #a3a29a; --border: #35352f;
      --critical: #f87171; --high: #fbbf24; --moderate: #a3e635; --low: #a1a1aa;
      --accent: #93c5fd; --warn-bg: #2a1f12; --warn-border: #7c4a13;
    }
  }
  :root[data-theme="dark"] {
    --bg: #14140f; --surface: #1e1e1a; --surface-2: #262622;
    --text: #ecebe4; --muted: #a3a29a; --border: #35352f;
    --critical: #f87171; --high: #fbbf24; --moderate: #a3e635; --low: #a1a1aa;
    --accent: #93c5fd; --warn-bg: #2a1f12; --warn-border: #7c4a13;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 2rem 1.25rem 6rem; background: var(--bg); color: var(--text);
    font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  }
  .wrap { max-width: 820px; margin: 0 auto; }
  h1 { font-size: 1.75rem; line-height: 1.25; margin: 0 0 .35rem; letter-spacing: -.02em; }
  h2 { font-size: 1.05rem; letter-spacing: .04em; text-transform: uppercase; margin: 2.5rem 0 1rem; }
  h3 { font-size: 1.05rem; margin: 0 0 .4rem; line-height: 1.35; }
  a { color: var(--accent); }
  .muted { color: var(--muted); font-size: .85rem; }
  .sub { color: var(--muted); margin: 0 0 2rem; }

  .score-card {
    display: flex; gap: 1.5rem; align-items: center; flex-wrap: wrap;
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 12px; padding: 1.5rem; margin-bottom: 1.5rem;
  }
  .score-num { font-size: 3rem; font-weight: 700; line-height: 1; letter-spacing: -.03em; }
  .score-band { font-size: 1.1rem; font-weight: 600; margin-bottom: .25rem; }
  .score-meaning { color: var(--muted); font-size: .9rem; margin: 0; max-width: 46ch; }

  .limits {
    background: var(--warn-bg); border: 1px solid var(--warn-border);
    border-radius: 12px; padding: 1.25rem 1.5rem; margin-bottom: 2rem;
  }
  .limits h2 { margin: 0 0 .6rem; font-size: .8rem; }
  /* Distinguished from the coverage limits: that block is always true, this
     one names what specifically went unchecked on this run. */
  .not-checked { background: var(--surface); border-color: var(--border); border-left: 4px solid var(--high); }
  .not-checked-lead { margin: 0 0 .6rem; font-size: .92rem; }
  .limits ul { margin: 0; padding-left: 1.15rem; }
  .limits li { margin-bottom: .5rem; font-size: .92rem; }
  .limits li:last-child { margin-bottom: 0; }

  .stats { display: flex; gap: .5rem; flex-wrap: wrap; margin-bottom: 2rem; }
  .stat {
    background: var(--surface); border: 1px solid var(--border); border-radius: 8px;
    padding: .6rem .9rem; font-size: .85rem;
  }
  .stat b { display: block; font-size: 1.3rem; line-height: 1.2; }

  .tier-heading-critical { color: var(--critical); }
  .tier-heading-high { color: var(--high); }
  .tier-heading-moderate { color: var(--moderate); }
  .tier-heading-low { color: var(--low); }

  .finding {
    border: 1px solid var(--border); border-left: 4px solid var(--low);
    border-radius: 10px; padding: 1.25rem; margin-bottom: 1rem; background: var(--surface);
  }
  .finding.tier-critical { border-left-color: var(--critical); }
  .finding.tier-high { border-left-color: var(--high); }
  .finding.tier-moderate { border-left-color: var(--moderate); }
  .finding-head { display: flex; gap: .9rem; align-items: flex-start; }
  .rank {
    flex: 0 0 auto; width: 1.9rem; height: 1.9rem; border-radius: 50%;
    background: var(--surface-2); border: 1px solid var(--border);
    display: grid; place-items: center; font-size: .8rem; font-weight: 700; color: var(--muted);
  }
  .finding-title { flex: 1 1 auto; min-width: 0; }
  .badges { display: flex; gap: .5rem; flex-wrap: wrap; align-items: center; }
  .tier { font-size: .72rem; font-weight: 700; text-transform: uppercase; letter-spacing: .05em;
          padding: .15rem .5rem; border-radius: 4px; border: 1px solid currentColor; }
  .tier-badge-critical { color: var(--critical); }
  .tier-badge-high { color: var(--high); }
  .tier-badge-moderate { color: var(--moderate); }
  .tier-badge-low { color: var(--low); }
  .wcag, .rule-id { font-size: .78rem; color: var(--muted); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .why { font-size: .93rem; margin: .9rem 0; }
  .stage {
    font-size: .7rem; text-transform: uppercase; letter-spacing: .05em; font-weight: 700;
    background: var(--surface-2); border-radius: 4px; padding: .1rem .4rem; color: var(--muted);
  }
  .stage-checkout, .stage-cart { color: var(--critical); }
  .stage-product, .stage-contact { color: var(--high); }

  details { margin: .75rem 0; }
  summary { cursor: pointer; font-size: .88rem; color: var(--muted); }
  details ul { margin: .6rem 0 0; padding-left: 1.1rem; }
  details li { margin-bottom: .35rem; font-size: .88rem; word-break: break-word; }
  .selector { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; word-break: break-all; margin: .5rem 0 .25rem; }

  .code {
    background: var(--surface-2); border: 1px solid var(--border); border-radius: 6px;
    padding: .8rem; overflow-x: auto; font-size: .82rem; line-height: 1.5;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; margin: .6rem 0 0;
  }
  .fix { border-top: 1px solid var(--border); margin-top: 1rem; padding-top: 1rem; }
  .fix-head { display: flex; justify-content: space-between; align-items: center; gap: 1rem; margin-bottom: .5rem; }
  .fix-summary { margin: 0 0 .6rem; font-size: .93rem; }
  .fix ol { margin: 0; padding-left: 1.15rem; }
  .fix li { margin-bottom: .4rem; font-size: .9rem; }
  .effort { font-size: .72rem; font-weight: 700; text-transform: uppercase; letter-spacing: .05em;
            padding: .15rem .5rem; border-radius: 4px; background: var(--surface-2); color: var(--muted); white-space: nowrap; }
  .no-fix { font-size: .9rem; color: var(--muted); }
  .warn { color: var(--high); font-size: .82rem; }
  .empty { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 1.5rem; }

  footer { margin-top: 3rem; padding-top: 1.5rem; border-top: 1px solid var(--border); color: var(--muted); font-size: .85rem; }
  footer p { margin: 0 0 .75rem; }

  @media print {
    body { padding: 0; } .finding { break-inside: avoid; } details { display: block; }
    details > summary { display: none; } details > *:not(summary) { display: block !important; }
  }
</style>
</head>
<body>
<div class="wrap">

  <h1>Accessibility findings for ${escapeHtml(host)}</h1>
  <p class="sub">
    Automated scan of ${report.pagesScanned.length} ${report.pagesScanned.length === 1 ? 'page' : 'pages'} ·
    ${escapeHtml(formatDate(report.scannedAt))} ·
    Platform: ${escapeHtml(PLATFORM_LABEL[report.platform])}
  </p>

  <div class="score-card">
    <div class="score-num" style="color: var(--${scoreColorVar(report.exposureScore)})">${report.exposureScore}</div>
    <div>
      <div class="score-band">${escapeHtml(band.label)} exposure</div>
      <p class="score-meaning">${escapeHtml(band.meaning)}</p>
    </div>
  </div>

  <div class="limits">
    <h2>What this scan does and does not cover</h2>
    <ul>
      <li><strong>This report does not certify compliance, and no scan can.</strong> Automated testing reliably detects roughly 30–60% of WCAG issues. The rest — whether alt text is actually <em>descriptive</em>, whether focus order is <em>logical</em>, whether an error message is <em>helpful</em> — requires human judgment.</li>
      <li><strong>Zero findings would not mean the site is accessible.</strong> It would mean the automatable checks passed. Manual and assistive-technology testing is the only way to assess the remainder.</li>
      <li><strong>Risk rankings are a prioritisation heuristic, not legal advice.</strong> They reflect which barriers are most often named in filed complaints. A plaintiff may plead anything, and only a lawyer can advise you on your exposure.</li>
      <li><strong>${report.pagesScanned.length} ${
        report.pagesScanned.length === 1 ? 'page was' : 'pages were'
      } scanned</strong>, chosen to cover the purchase path. Pages behind login, and states that require interaction to reach (open modals, expanded menus, validation errors), were not tested.</li>
    </ul>
  </div>

  ${
    report.warnings.length
      ? `<div class="limits not-checked">
           <h2>What could not be checked</h2>
           <p class="not-checked-lead">These pages were not scanned, so nothing below reflects them. A page that was skipped is not a page that came back clean.</p>
           <ul>${report.warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join('')}</ul>
         </div>`
      : ''
  }

  <div class="stats">
    <div class="stat"><b>${report.summary.critical}</b> most-cited</div>
    <div class="stat"><b>${report.summary.high}</b> commonly cited</div>
    <div class="stat"><b>${report.summary.moderate}</b> rarely pleaded</div>
    <div class="stat"><b>${report.summary.low}</b> best practice</div>
    <div class="stat"><b>${report.summary.totalInstances}</b> total elements</div>
    <div class="stat"><b>${report.passedRuleCount}</b> checks passed</div>
    <div class="stat"><b>${report.incompleteRuleCount}</b> need review</div>
  </div>

  ${
    priority.length
      ? `<h2>Start here</h2>
         <p>These ${priority.length} ${
           priority.length === 1 ? 'barrier is' : 'barriers are'
         } the kind named directly in demand letters. Fixing them in this order clears the most exposure for the least work.</p>
         <ol class="muted" style="font-size:.95rem">${priority
           .slice(0, 5)
           .map((f) => `<li>${escapeHtml(f.description)}</li>`)
           .join('')}</ol>`
      : ''
  }

  <h2>All findings, ranked</h2>
  ${findingsHtml}

  <h2>Pages scanned</h2>
  <ul>${pagesList}</ul>

  <footer>
    <p><strong>Keep this report.</strong> A dated record of what you found and when you fixed it is evidence of good-faith remediation effort, which matters if a demand letter ever arrives.</p>
    <p>Generated by Curbcut on ${escapeHtml(formatDate(report.scannedAt))}. Testing engine: axe-core. Standard tested: WCAG 2.1 Level AA.</p>
    <p>Curbcut is not a law firm and this report is not legal advice.</p>
  </footer>

</div>
</body>
</html>`;
}

function scoreColorVar(score: number): string {
  if (score >= 70) return 'critical';
  if (score >= 40) return 'high';
  if (score >= 15) return 'moderate';
  return 'low';
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Compact terminal summary, for the CLI. */
export function renderTerminalSummary(report: ScanReport): string {
  const band = exposureBand(report.exposureScore);
  const lines: string[] = [
    '',
    `  ${safeHost(report.site)} — exposure ${report.exposureScore}/100 (${band.label})`,
    `  ${report.pagesScanned.length} pages · ${PLATFORM_LABEL[report.platform]} · ${report.summary.totalInstances} failing elements`,
    '',
  ];

  const top = report.findings.slice(0, 8);
  if (!top.length) {
    lines.push('  No automated violations found. This is not the same as being accessible.', '');
  } else {
    for (const [i, f] of top.entries()) {
      lines.push(`  ${String(i + 1).padStart(2)}. [${f.tier.toUpperCase()}] ${f.description}`);
      lines.push(`      ${f.instanceCount} ${f.instanceCount === 1 ? 'element' : 'elements'} · ${f.ruleId}`);
    }
    if (report.findings.length > top.length) {
      lines.push('', `  ...and ${report.findings.length - top.length} more in the full report.`);
    }
    lines.push('');
  }

  lines.push('  Automated checks catch roughly 30-60% of WCAG issues. This is not a compliance certificate.', '');
  return lines.join('\n');
}

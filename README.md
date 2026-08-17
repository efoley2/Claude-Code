# Curbcut

Web accessibility scanning that ranks findings by how often each barrier actually appears in ADA complaints — not by generic WCAG severity.

Built for small e-commerce operators who are the primary target of web accessibility litigation and for whom a $3,000 manual audit is not realistic.

**This tool does not certify compliance, and it says so in every report it produces.** Automated testing detects roughly 30–60% of WCAG issues; the remainder requires human judgment. Any product in this space claiming otherwise is making the claim the FTC fined a major vendor $1M for.

See [`business/PLAN.md`](business/PLAN.md) for the market analysis, pricing, and go-to-market plan.

## Install

```bash
npm install
npx playwright install chromium   # skip if a system Chromium is already present
```

## Use

```bash
# Scan a site and write an HTML report
npm run scan -- yourstore.com --out report.html

# Scan more pages, also emit raw JSON
npm run scan -- yourstore.com --pages 10 --out report.html --json findings.json
```

| Flag | Default | Meaning |
|---|---|---|
| `-o, --out <path>` | — | Write the HTML report here |
| `-j, --json <path>` | — | Write raw findings as JSON here |
| `-p, --pages <n>` | `6` | Maximum pages to scan |
| `-t, --timeout <ms>` | `30000` | Per-page navigation timeout |
| `-q, --quiet` | off | Suppress progress output |

Generate a sample report from the bundled fixtures, without touching any live site:

```bash
npx tsx scripts/demo-report.mts sample-report.html
```

## How it differs from a free scanner

A free scanner sorts by WCAG severity, so a missing form label lands below fifty landmark warnings. Curbcut changes the ranking on three axes:

1. **Litigation tiering** — ~150 axe rules mapped to how often each barrier is named in filed complaints. Missing alt text, unlabelled dropdowns and empty buttons rank at the top because that is what demand letters enumerate.
2. **Journey weighting** — the same contrast failure scores 2× on checkout versus a footer, because courts increasingly expect a barrier to be tied to a genuinely blocked task.
3. **Platform-specific fixes** — "Products → select product → set Alt text" for Shopify, rather than a link to a W3C spec page.

Findings are also deduplicated across pages: one rule failing on five pages is one template fix, presented once, scored at its worst location.

## Architecture

| File | Responsibility |
|---|---|
| `src/risk.ts` | Litigation-risk tiers, journey weights, scoring curve. The core IP. |
| `src/scanner.ts` | Playwright + axe-core, page discovery, cross-page aggregation |
| `src/platform.ts` | Detects Shopify / WooCommerce / Wix / Squarespace / BigCommerce / Webflow |
| `src/fixes.ts` | Platform-specific remediation guidance |
| `src/report.ts` | HTML and terminal report rendering |
| `src/cli.ts` | Command-line entry point |

### Scoring

Each finding scores `tierWeight × (1 + log₂ instances) × stageWeight`, summed and mapped through a saturating curve to a 0–100 exposure score.

Instance count scales sub-linearly on purpose: 200 missing alt attributes is worse than one, but it is one systemic template bug with one fix — linear scaling would let a single repeated rule swamp the report, which is exactly the failure mode of free scanners.

## Tests

```bash
npm test         # 44 tests
npm run typecheck
```

Integration tests scan a bundled fixture site with deliberately planted violations, so results are deterministic and do not depend on a third party's deploy schedule.

Two test groups are load-bearing rather than incidental:

- **Ranking invariants** — one critical barrier must outrank fifty best-practice ones; checkout must outweigh footer.
- **Honesty constraints** — the report is parsed for affirmative compliance claims, with negation awareness so the tool's own disclaimers ("would *not* mean the site is accessible") do not trip it. If anyone ever adds "your site is now compliant" to a template, the build fails.

## Environment notes

- Chromium resolution falls back to a system browser when the bundled Playwright revision is unavailable. Override with `CURBCUT_CHROMIUM_PATH`.
- `HTTPS_PROXY` / `NO_PROXY` are honoured and passed through to the browser.

## Licence

Unlicensed / private.

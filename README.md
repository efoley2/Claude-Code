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
| `--no-robots` | off | Ignore `robots.txt`. Only for a site you own. |
| `--allow-private` | off | Permit loopback and private-network targets. Only for a site you own. |

### Batch mode

Scanning a prospect list is the go-to-market motion described in `business/PLAN.md` §5 — scan first, then lead the email with the prospect's own findings.

```bash
npx tsx src/cli.ts batch domains.txt --out ranked.csv --reports reports/
```

The input is one domain per line; blank lines and `#` comments are ignored. Output is a CSV ranked by exposure score, with a `status` column that is either `qualified` or `DO-NOT-CONTACT (<reason>)`. **A site that scans clean is marked do-not-contact** — emailing someone with nothing wrong is the behaviour this product exists to be the opposite of. Failed scans are marked the same way, since a domain that would not load has not been assessed.

The `finding_1..3` columns hold plain-English bullets ready to paste. They are deliberately bullets and not a drafted email: recipients pattern-match AI-written outreach and reply rates collapse when they do.

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
| `src/robots.ts` | robots.txt fetching and RFC 9309 evaluation |
| `src/safety.ts` | SSRF target guard and per-origin rate limiting |
| `src/batch.ts` | Bounded-concurrency prospect scanning, CSV output |
| `src/outreach.ts` | Turns findings into pasteable plain-English bullets |
| `src/cli.ts` | Command-line entry point (`scan`, `batch`) |
| `web/index.html` | Landing page. Scores 0 on this project's own scanner. |

### Scoring

Each finding scores `tierWeight × (1 + log₂ instances) × stageWeight`, summed and mapped through a saturating curve to a 0–100 exposure score.

Instance count scales sub-linearly on purpose: 200 missing alt attributes is worse than one, but it is one systemic template bug with one fix — linear scaling would let a single repeated rule swamp the report, which is exactly the failure mode of free scanners.

## Tests

```bash
npm test         # 198 tests
npm run typecheck
```

Integration tests scan a bundled fixture site with deliberately planted violations, so results are deterministic and do not depend on a third party's deploy schedule. No test reaches the public internet.

Four test groups are load-bearing rather than incidental:

- **Ranking invariants** — one critical barrier must outrank fifty best-practice ones; checkout must outweigh footer.
- **Honesty constraints** — the report and every outreach bullet are parsed for affirmative compliance claims, with negation awareness so the tool's own disclaimers (“would *not* mean the site is accessible”) do not trip it. If anyone ever adds “your site is now compliant” to a template, the build fails.
- **Risk-model integrity** — every mapped rule id must exist in axe-core, must be reachable under the scanner's tags, and every reachable rule must be mapped. An id that exists but is out of scope is exactly as dead as a typo, and the middle assertion is the one that catches it.
- **Target safety** — the SSRF guard is tested against the usual bypasses, including IPv4-mapped and NAT64-wrapped addresses and redirect-based escapes.

## Safety and etiquette

The scanner reads other people's websites uninvited, so restraint is enforced in code rather than left to intention:

- `robots.txt` is obeyed by default. A disallowed page is skipped **and named in the report** — a page silently omitted is indistinguishable from a page that came back clean.
- Requests to the same origin are paced (1s floor, raised by `Crawl-delay`, capped so a directive aimed at bulk indexers cannot hang a scan).
- Non-public targets — loopback, RFC1918, CGNAT, link-local, cloud metadata — are refused by default, and re-checked on redirect so a public host cannot 302 into internal space.
- The scanner identifies itself honestly in its User-Agent.

Both opt-outs (`--no-robots`, `--allow-private`) exist for scanning your own staging site, and the first prints a warning when used.

## Environment notes

- Chromium resolution falls back to a system browser when the bundled Playwright revision is unavailable. Override with `CURBCUT_CHROMIUM_PATH`.
- `HTTPS_PROXY` / `NO_PROXY` are honoured and passed through to both the browser and the robots.txt fetch.
- `CURBCUT_ALLOW_PRIVATE_TARGETS=1` lifts the private-target guard. It is set automatically under test.

## Licence

Unlicensed / private.

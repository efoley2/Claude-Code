# Curbcut — business plan

Honest web accessibility scanning, priced for the businesses actually being sued.

**Constraints this plan is built for:** no existing audience, no industry access, 10–20 hrs/week, small budget.

---

## 1. Why this market

Four facts, each independently verifiable, that together make the case:

| Fact | Why it matters |
|---|---|
| ~3,100 federal web-accessibility suits in 2025, up 27%; 5,000+ including state filings | The pain is real and growing, not speculative |
| An estimated 35,000–50,000 demand letters sent in 2025 | The addressable pain is ~10× the lawsuit count |
| 69% of H1 2025 suits targeted online stores; most defendants are under $25M revenue | The buyer is a small e-commerce operator — enumerable and reachable |
| The FTC fined accessiBe $1M for false "AI makes you compliant" claims; ~38.5% of businesses sued in 2025 already had an accessibility widget installed | **The incumbent solution is now a known liability** |

That last row is the actual opportunity. This is a market where the dominant product has been publicly discredited by a federal regulator, and where the customers who bought it are discovering it did not work. Honesty is available as a differentiator here in a way it rarely is.

### The gap

| Option | Price | Problem |
|---|---|---|
| Free scanners (axe DevTools, WAVE, Lighthouse) | $0 | Wall of undifferentiated violations; no priority, no fix, no record |
| Overlay widgets | ~$490/yr | FTC-fined; actively correlated with being sued |
| Manual audit | $1,500–$5,000 | Correctly priced for enterprises, unaffordable for the SMBs being targeted |
| **Curbcut** | **$299 one-off / $79 mo** | — |

Nothing honest exists between "free and useless" and "$3,000".

---

## 2. What the product is — and is not

**Is:** an automated scanner that ranks findings by how often each barrier is actually named in ADA complaints, weights them by where they sit in the purchase path, gives platform-specific fixes, and produces a dated record of remediation effort.

**Is not:** a compliance certificate. Automated testing catches roughly 30–60% of WCAG issues; the rest needs human judgment. The report says so above the findings, and a test in the suite fails the build if any affirmative compliance claim appears in the output.

That constraint is not a legal formality — it *is* the product. The competitor that claimed otherwise got fined, and the customers who believed it got sued anyway.

### The genuine IP

`axe-core` is free and open source. Anyone can build a scanner. What is not free:

1. **The risk model** (`src/risk.ts`) — ~150 axe rules mapped to litigation-frequency tiers. A free scanner sorts by WCAG severity and buries a missing form label under 50 landmark warnings. This inverts that.
2. **Journey weighting** — a contrast failure on the checkout button scores 2× the same failure in the footer, because courts increasingly want barriers tied to a real blocked task.
3. **Platform-specific remediation** — "edit `snippets/product-card.liquid`" instead of a link to a W3C spec page.
4. **The outbound motion** (§5), which the software enables at near-zero marginal cost.

Be clear-eyed: this is a positioning and distribution advantage, not a technical moat. It is defensible for the 12–24 months that matter to a solo operator, and not much longer.

---

## 3. Pricing

Three tiers. The software generates leads at zero marginal cost; the service converts them at high ticket.

**Barrier Report — $299 one-off**
Scan of up to 10 pages, ranked report, 30-minute walkthrough call. This is the entry offer and the sales instrument for everything else.

**Monitoring — $79/mo, or $790/yr**
Monthly re-scan, alerts when new barriers appear (a theme update reintroduces them constantly), and an accumulating dated remediation record. Anchored well below the $300–900/mo market rate for monitoring.

**Remediation — $1,200–$2,500 fixed-scope**
You fix the critical and high-tier barriers on their Shopify/WooCommerce theme. Priced fixed, never hourly. This is where the revenue actually is, and it is what consumes your 10–20 hrs/week.

### Unit economics

| Line | Amount |
|---|---|
| Marginal cost per scan | <$0.01 (~30s CPU) |
| Hosting (VPS, runs the scanner and a landing page) | $20–40/mo |
| Domain, email sending, business registration | ~$50/mo amortised |
| **Fixed monthly burn** | **~$60–90** |
| Gross margin, $299 report | ~99% minus 30 min of your time |
| Gross margin, $79/mo monitoring | ~99% |
| Effective rate, $1,500 remediation at 6–8 hrs | **$190–250/hr** |

The burn is low enough that this cannot fail expensively. That is the main thing a small budget buys you.

### Realistic revenue path

Research benchmark: median time to $10K MRR for bootstrapped micro-SaaS is 12–18 months. Do not plan around beating it.

| Milestone | Composition | Honest timeline |
|---|---|---|
| First $299 | 1 report sold | Weeks 3–6 |
| $1,000/mo | 2 remediations + 5 monitoring | Months 3–5 |
| $3,000/mo | 2 remediations + 20 monitoring | Months 6–10 |
| $5,000/mo | 3 remediations + 35 monitoring | Months 10–18 |

At 10–20 hrs/week, **$3,000–5,000/mo is the realistic ceiling within a year**, and that is a good outcome. $10K/mo requires either more hours or hiring the remediation work out.

---

## 4. The customer

**Target:** US-based e-commerce store, Shopify or WooCommerce, roughly $500K–$15M revenue, no in-house developer.

**Why this shape:** big enough to afford $299 and to fear a $30K settlement; small enough that no one has already sold them an enterprise contract; on a platform where fixes are templated and repeatable for you.

**Deliberately excluded:**
- **EU/UK businesses at first.** The EAA exempts firms under 10 employees / €2M turnover, so the small end is not compelled — and GDPR/PECR make cold email far riskier than US CAN-SPAM. Start US-only.
- **Businesses already sued.** Ambulance-chasing is a reputational and legal trap. Never reference an active or past legal matter in outreach.
- **Enterprises.** They need manual audits and VPAT documentation you cannot provide.

---

## 5. Go-to-market: the scan-first cold email

You have no audience, so outbound is the only channel that produces conversations this quarter. Inbound SEO takes 6–12 months to compound and now faces a ~1% CTR ceiling on informational queries thanks to AI Overviews. Build the SEO layer, but do not wait on it.

**The mechanic that makes this work:** run the scan *before* you email, and lead with their actual findings. Cold email fails because it is generic. This is a personalised, specific, verifiable artifact about their own site — and it costs you under a cent to produce.

### The sequence

**Email 1 — the finding, not the pitch.**

> Subject: 3 accessibility issues on yourstore.com
>
> Hi {name} — I run automated accessibility scans on Shopify stores. Yours came back with three issues of the kind most often named in ADA website complaints:
>
> • 14 product images with no alt text
> • The size dropdown on your product pages has no label
> • Your "Add to cart" button fails contrast at 2.9:1
>
> Full report, free, no signup: {link}
>
> Worth knowing: about 5,000 web accessibility suits were filed last year, and most defendants were under $25M in revenue. I'm not a lawyer and this isn't legal advice — but these three are cheap to fix.
>
> If it's useful I'll walk you through the fixes on a 20-minute call. If not, ignore this and the report stays up for a week.
>
> — {your name}, {address}. Unsubscribe: {link}

**Email 2 (day 4):** one specific fix, given away free, with the code. Costs nothing; proves competence.
**Email 3 (day 9):** one-line breakup. "Closing this out — report's still at {link} if useful."

Then stop. Three emails, no more.

### Why this converts better than a normal cold email

- It leads with a fact about *their* property, not a claim about you.
- The free artifact is genuinely valuable and independently verifiable.
- It never asserts they will be sued — the fear is factual and cited, not manufactured.
- The call is the ask, not the sale.

**Do not let an AI write these in bulk.** Recipients pattern-match AI-written outreach immediately and reply rates collapse when they do. The findings are generated; the sentences around them should sound like you.

### Volume and expected yield

Be conservative. Plan on:

- 40–60 personalised sends/day, 4 days/week (50–100/day is the documented solo ceiling; stay under it while learning)
- 3–8% reply rate — better than typical cold email *because* of the personalised artifact
- ~1 customer per 100–200 sends at first, improving as you learn the niche

That is roughly **2–4 days of outreach per customer** early on. Track it, because if your real numbers are 3× worse than this, the offer is wrong and you should change it before scaling volume.

### Building the list

1. **BuiltWith / Wappalyzer free tiers** — filter Shopify or WooCommerce by country and category.
2. **Shopify app store reviews** — reviewers are real, active, identifiable stores.
3. **Niche directories and trade associations** — pick 2–3 verticals and go deep rather than spraying.
4. **Qualify before scanning:** active social or recent reviews (proves revenue), US-based, no in-house dev (no engineering job listings), and a site that actually fails the scan. *Never email someone whose site came back clean.*

Pick two or three verticals and stay in them. A store owner who hears you also fixed three other shops in their category is a warm referral engine; a generalist is noise.

### Scanning etiquette

You are hitting other people's servers uninvited. This matters both ethically and for not getting blocked:

- The scanner identifies itself honestly in its User-Agent. Leave it that way.
- Respect `robots.txt`, scan a handful of pages, never hammer a site.
- Scan only publicly reachable pages. Never attempt anything behind a login.
- Honour removal requests immediately and permanently.

---

## 6. Legal and ethical guardrails

**The single biggest risk to this business is becoming the thing it is positioned against.** The market is full of bad actors; the FTC has already fined the largest one. Your entire differentiation is being the honest option, and it is one bad email template away from being gone.

Hard rules:

1. **Never claim compliance, protection, or certification.** Enforced by a test in the suite (`test/scan.test.ts`). Apply the same rule to the landing page and every email.
2. **Never state or imply that a specific business will be sued.** Cite aggregate statistics, attribute them, and stop there.
3. **Never imply affiliation with the DOJ, FTC, a court, or a law firm.**
4. **Never mimic a demand letter** in formatting, subject line, or tone.
5. **Say "I am not a lawyer and this is not legal advice"** and mean it. Refer legal questions to a lawyer.
6. **CAN-SPAM compliance is mandatory:** real physical address in every email, working one-click unsubscribe honoured within 10 days, no deceptive subject lines. US B2B cold email is lawful on an opt-out basis; EU/UK is not — another reason to start US-only.
7. **Do not reference anyone's litigation history**, active or past.

Business setup: a single-member LLC (~$100–500 depending on state) plus general liability insurance is proportionate. Talk to an accountant before the first invoice, not after. Consider errors-and-omissions cover once you are selling remediation work rather than reports.

---

## 7. Honest assessment of the odds

**What is genuinely strong:**
- Quantified, fear-driven, recurring pain with an established willingness to pay
- Enumerable buyers reachable by cold outbound with no audience required
- The dominant incumbent has been discredited by a federal regulator
- Near-zero marginal cost and a ~$60–90/mo burn — this cannot fail expensively
- Honest positioning is available and currently unoccupied

**What is genuinely hard:**
- **The market is crowded at the top.** AudioEye, UsableNet, Level Access and accessiBe are all far better funded. You win on price, honesty and specificity for the small end, or you do not win.
- **The technology is not the moat.** axe-core is free. Your advantage is the risk model, the fixes and the outbound machine — all copyable within a year by anyone who notices.
- **The category has a credibility problem** you did not create and will have to overcome in every first conversation.
- **Platform absorption risk.** If Shopify ships a good native accessibility audit, the diagnosis half of this business compresses hard. Mitigation: the remediation service is the durable half — someone still has to do the work.
- **Regulatory risk cuts both ways.** DOJ rulemaking or a circuit split could expand the market or shrink it.
- **The base rate is unforgiving.** ~30% of micro-SaaS never reach $1K MRR; ~50% plateau between $1K and $10K. Over 70% of failed founders cite "not enough customers" — never "bad code."

**The honest bottom line:** the build is done and it works. Whether this makes money now depends almost entirely on whether you send several hundred well-written, personalised emails over the next eight weeks. That is the actual job, and it is the part no software can do for you.

If you are not going to do the outreach, do not run this business — the code will not save it.

---

## 8. First 90 days

**Weeks 1–2 — infrastructure**
Register the LLC and a domain. Set up a business email with SPF/DKIM/DMARC and warm it for two weeks before sending volume. Stand up the scanner on a $20 VPS. Publish a one-page site: what it is, what it does not do, the $299 offer, sample report.

**Weeks 3–4 — first 50**
Build a list of 200 qualified stores in two verticals. Scan them. Email the 50 worst by hand — genuinely by hand, to learn what lands. Target: 3 calls, 1 sale.

**Weeks 5–8 — find repeatability**
Scale to 40–60 sends/day. Track sends → replies → calls → sales, weekly. Deliver the first remediation job and time yourself honestly; reprice if $1,200 turns out to be six hours plus three rounds of revisions. Target: $1,000 cumulative revenue.

**Weeks 9–12 — compound**
Convert report buyers to monitoring; that is where retention lives. Ask every satisfied customer for one referral in their vertical. Publish the first three SEO pieces ("WCAG contrast on Shopify", etc.) so the inbound layer starts compounding for month 9. Target: $1,000/mo recurring plus one remediation job.

**The metric that matters in month one is replies, not revenue.** If 200 personalised emails produce fewer than five replies, the offer or the targeting is wrong — fix that before sending another 200.

---

## Sources

- [UsableNet ADA lawsuit tracker](https://info.usablenet.com/ada-website-compliance-lawsuit-tracker)
- [EcomBack 2025 ADA lawsuit annual report](https://www.ecomback.com/annual-2025-ada-website-accessibility-lawsuit-report)
- [FTC / accessiBe $1M settlement](https://www.hinckleyallen.com/publications/ftc-deceptive-accessibility-claims-widgets-automated-tools/)
- [Overlay Fact Sheet](https://overlayfactsheet.com/)
- [Deque: axe-core coverage and limits](https://www.deque.com/axe/axe-core/)
- [Accessible.org audit pricing](https://accessible.org/pricing/)
- [European Accessibility Act e-commerce requirements](https://accessible.org/eaa-ecommerce-services-requirements/)
- [MicroConf State of Independent SaaS](https://microconf.com/state-of-indie-saas)

#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Command } from 'commander';
import { scanSite } from './scanner.js';
import { renderHtmlReport, renderTerminalSummary } from './report.js';
import { parseDomainList, reportFilename, scanBatch, toCsv, type BatchResult } from './batch.js';

const program = new Command();

program
  .name('curbcut')
  .description('Scan websites for accessibility barriers, ranked by how often they appear in ADA complaints.');

function writeOut(path: string, contents: string): string {
  const full = resolve(path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, contents, 'utf8');
  return full;
}

function positiveInt(value: string, min: number, label: string): number {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < min) {
    process.stderr.write(`${label} must be at least ${min}\n`);
    process.exitCode = 2;
    return NaN;
  }
  return n;
}

/**
 * The single-URL scan stays the default command, so `curbcut example.com`
 * keeps working unchanged now that there is more than one subcommand.
 */
program
  .command('scan', { isDefault: true })
  .description('scan one site and write a report')
  .argument('<url>', 'site to scan, e.g. example.com')
  .option('-o, --out <path>', 'write an HTML report to this path')
  .option('-j, --json <path>', 'write raw findings as JSON to this path')
  .option('-p, --pages <n>', 'maximum pages to scan', '6')
  .option('-t, --timeout <ms>', 'per-page navigation timeout', '30000')
  .option('-q, --quiet', 'suppress progress output')
  .option('--no-robots', 'ignore robots.txt — only for a site you own')
  .option('--allow-private', 'permit loopback and private-network targets — only for a site you own')
  .action(async (url: string, opts) => {
    const maxPages = positiveInt(opts.pages, 1, '--pages');
    const timeout = positiveInt(opts.timeout, 1000, '--timeout');
    if (!Number.isFinite(maxPages) || !Number.isFinite(timeout)) return;

    // Both opt-outs exist for scanning your own staging site. Say so out loud:
    // silently ignoring robots.txt on someone else's property is the behaviour
    // this product's positioning cannot survive being caught doing.
    if (!opts.robots) process.stderr.write('Ignoring robots.txt at your instruction. Only do this for a site you own.\n');

    try {
      const report = await scanSite(url, {
        maxPages,
        timeout,
        verbose: !opts.quiet,
        respectRobots: opts.robots,
        ...(opts.allowPrivate ? { allowPrivateTargets: true } : {}),
      });

      if (opts.out) {
        process.stderr.write(`\nHTML report written to ${writeOut(opts.out, renderHtmlReport(report))}\n`);
      }
      if (opts.json) {
        process.stderr.write(`JSON written to ${writeOut(opts.json, JSON.stringify(report, null, 2))}\n`);
      }

      process.stdout.write(renderTerminalSummary(report));
    } catch (err) {
      process.stderr.write(`\nScan failed: ${(err as Error).message}\n`);
      process.exitCode = 1;
    }
  });

program
  .command('batch')
  .description('scan a list of domains and rank them by exposure')
  .argument('<file>', 'file of domains, one per line; blanks and # comments ignored')
  .option('-o, --out <path>', 'write the ranked CSV here (default: stdout)')
  .option('-r, --reports <dir>', 'also write a per-domain HTML report into this directory')
  .option('-c, --concurrency <n>', 'domains to scan in parallel', '3')
  .option('-p, --pages <n>', 'maximum pages per domain', '6')
  .option('-t, --timeout <ms>', 'per-page navigation timeout', '30000')
  .option('-q, --quiet', 'suppress progress output')
  .action(async (file: string, opts) => {
    const concurrency = positiveInt(opts.concurrency, 1, '--concurrency');
    const maxPages = positiveInt(opts.pages, 1, '--pages');
    const timeout = positiveInt(opts.timeout, 1000, '--timeout');
    if (!Number.isFinite(concurrency) || !Number.isFinite(maxPages) || !Number.isFinite(timeout)) return;

    let domains: string[];
    try {
      domains = parseDomainList(readFileSync(resolve(file), 'utf8'));
    } catch (err) {
      process.stderr.write(`Could not read ${file}: ${(err as Error).message}\n`);
      process.exitCode = 2;
      return;
    }

    if (domains.length === 0) {
      process.stderr.write(`No domains found in ${file}\n`);
      process.exitCode = 2;
      return;
    }

    const reportsDir = opts.reports ? resolve(opts.reports) : undefined;
    if (reportsDir) mkdirSync(reportsDir, { recursive: true });

    const verbose = !opts.quiet;
    if (verbose) process.stderr.write(`Scanning ${domains.length} domains, ${concurrency} at a time\n`);

    // Reports are written as each domain settles rather than at the end, so an
    // interrupted run still leaves usable artifacts behind.
    const onResult = reportsDir
      ? (result: BatchResult) => {
          if (result.report) {
            writeFileSync(join(reportsDir, reportFilename(result.domain)), renderHtmlReport(result.report), 'utf8');
          }
        }
      : undefined;

    const results = await scanBatch(domains, { concurrency, maxPages, timeout, verbose, onResult });
    const csv = toCsv(results);

    if (opts.out) {
      process.stderr.write(`\nCSV written to ${writeOut(opts.out, csv)}\n`);
    } else {
      process.stdout.write(csv);
    }
    if (reportsDir) process.stderr.write(`HTML reports written to ${reportsDir}\n`);

    const scanned = results.filter((r) => r.report);
    const qualified = scanned.filter((r) => r.outreach!.qualification.qualified);
    if (verbose) {
      process.stderr.write(
        `\n${results.length} domains: ${scanned.length} scanned, ${results.length - scanned.length} failed.\n` +
          `${qualified.length} qualified for outreach; ${results.length - qualified.length} marked DO-NOT-CONTACT.\n` +
          'The findings columns are facts about each site, not an email. Write the sentences around them yourself.\n',
      );
    }

    if (scanned.length === 0) process.exitCode = 1;
  });

program.parseAsync(process.argv);

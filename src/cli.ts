#!/usr/bin/env node
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Command } from 'commander';
import { scanSite } from './scanner.js';
import { renderHtmlReport, renderTerminalSummary } from './report.js';

const program = new Command();

program
  .name('curbcut')
  .description('Scan a website for accessibility barriers, ranked by how often they appear in ADA complaints.')
  .argument('<url>', 'site to scan, e.g. example.com')
  .option('-o, --out <path>', 'write an HTML report to this path')
  .option('-j, --json <path>', 'write raw findings as JSON to this path')
  .option('-p, --pages <n>', 'maximum pages to scan', '6')
  .option('-t, --timeout <ms>', 'per-page navigation timeout', '30000')
  .option('-q, --quiet', 'suppress progress output')
  .action(async (url: string, opts) => {
    const maxPages = Number.parseInt(opts.pages, 10);
    const timeout = Number.parseInt(opts.timeout, 10);

    if (!Number.isFinite(maxPages) || maxPages < 1) {
      process.stderr.write('--pages must be a positive integer\n');
      process.exitCode = 2;
      return;
    }
    if (!Number.isFinite(timeout) || timeout < 1000) {
      process.stderr.write('--timeout must be at least 1000ms\n');
      process.exitCode = 2;
      return;
    }

    try {
      const report = await scanSite(url, { maxPages, timeout, verbose: !opts.quiet });

      if (opts.out) {
        const path = resolve(opts.out);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, renderHtmlReport(report), 'utf8');
        process.stderr.write(`\nHTML report written to ${path}\n`);
      }
      if (opts.json) {
        const path = resolve(opts.json);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, JSON.stringify(report, null, 2), 'utf8');
        process.stderr.write(`JSON written to ${path}\n`);
      }

      process.stdout.write(renderTerminalSummary(report));
    } catch (err) {
      process.stderr.write(`\nScan failed: ${(err as Error).message}\n`);
      process.exitCode = 1;
    }
  });

program.parseAsync(process.argv);

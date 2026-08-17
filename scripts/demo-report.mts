/**
 * Generate a sample report from the bundled fixture site.
 *
 * A sample report is a sales asset — prospects want to see the deliverable
 * before they hand over a URL — and regenerating it from fixtures keeps the
 * sample honest as the scanner changes.
 *
 * Usage: npx tsx scripts/demo-report.mts [outputPath]
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { startFixtureServer } from '../test/server.js';
import { scanSite } from '../src/scanner.js';
import { renderHtmlReport, renderTerminalSummary } from '../src/report.js';

const out = resolve(process.argv[2] ?? 'sample-report.html');

const server = await startFixtureServer();
try {
  const report = await scanSite(server.url, { maxPages: 5, verbose: true });

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, renderHtmlReport(report), 'utf8');

  process.stdout.write(renderTerminalSummary(report));
  process.stderr.write(
    [
      `Pages scanned: ${report.pagesScanned.map((p) => p.stage).join(', ')}`,
      `Exposure: ${report.exposureScore}/100`,
      `Report written to ${out}`,
      '',
    ].join('\n'),
  );
} finally {
  await server.close();
}

// Writes a score table (and the key timings behind it) to the job log and GitHub job summary.
import { appendFileSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';

const dir = new URL('../lhci-report/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', dir), 'utf8'));
const pct = (v) => (v == null ? '–' : Math.round(v * 100));
const lines = [
  '### Lighthouse (mobile)',
  '',
  '| Page | Performance | Accessibility | Best practices | FCP | LCP | TBT | CLS |',
  '|---|---|---|---|---|---|---|---|',
];
const details = [];
for (const r of manifest.filter((x) => x.isRepresentativeRun)) {
  const report = JSON.parse(readFileSync(new URL(basename(r.jsonPath), dir), 'utf8'));
  const a = report.audits;
  const v = (id) => a[id]?.displayValue ?? '–';
  const s = r.summary;
  const page = new URL(r.url).pathname;
  lines.push(
    `| ${page} | ${pct(s.performance)} | ${pct(s.accessibility)} | ${pct(s['best-practices'])} | ${v('first-contentful-paint')} | ${v('largest-contentful-paint')} | ${v('total-blocking-time')} | ${v('cumulative-layout-shift')} |`,
  );
  const lcp = a['largest-contentful-paint-element']?.details?.items?.[0]?.items?.[0]?.node?.snippet;
  const shifts = (a['layout-shifts']?.details?.items ?? [])
    .slice(0, 3)
    .map((i) => `${i.node?.snippet ?? '?'} (${i.score?.toFixed?.(3)})`);
  details.push(
    `- ${page}: LCP element ${lcp ?? '–'}${shifts.length ? `; layout shifts: ${shifts.join(', ')}` : ''}`,
  );
}
const md = [...lines, '', ...details, ''].join('\n');
console.log(md);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);

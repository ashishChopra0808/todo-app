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
  // Audit ids differ between Lighthouse versions, so search every LCP-related audit for the element.
  const firstSnippet = (node) => {
    if (!node || typeof node !== 'object') return undefined;
    if (typeof node.snippet === 'string') return node.snippet;
    for (const value of Object.values(node)) {
      const found = firstSnippet(value);
      if (found) return found;
    }
    return undefined;
  };
  const lcpAudits = Object.keys(a).filter((id) => /lcp|largest-contentful-paint-element/.test(id));
  const lcp = lcpAudits.map((id) => firstSnippet(a[id]?.details)).find(Boolean);
  const breakdown = lcpAudits
    .map((id) => JSON.stringify(a[id]?.details?.items ?? []).slice(0, 400))
    .join(' ');
  const scripts = (a['bootup-time']?.details?.items ?? [])
    .slice(0, 3)
    .map((i) => `${String(i.url).split('/').pop()} ${Math.round(i.total)}ms`);
  details.push(
    `- ${page}: LCP element ${lcp ?? '–'} | audits ${lcpAudits.join(', ')} | script time ${scripts.join(', ')}`,
  );
  if (page === '/tasks') details.push(`  - LCP details: ${breakdown}`);
}
const md = [...lines, '', ...details, ''].join('\n');
console.log(md);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);

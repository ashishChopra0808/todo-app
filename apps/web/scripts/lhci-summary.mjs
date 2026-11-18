// Writes a score table for each measured page to the GitHub job summary.
import { appendFileSync, readFileSync } from 'node:fs';

const manifest = JSON.parse(
  readFileSync(new URL('../lhci-report/manifest.json', import.meta.url), 'utf8'),
);
const rows = manifest
  .filter((r) => r.isRepresentativeRun)
  .map((r) => {
    const s = r.summary;
    const pct = (v) => (v == null ? '–' : Math.round(v * 100));
    return `| ${new URL(r.url).pathname} | ${pct(s.performance)} | ${pct(s.accessibility)} | ${pct(s['best-practices'])} |`;
  });
const md = [
  '### Lighthouse (mobile)',
  '',
  '| Page | Performance | Accessibility | Best practices |',
  '|---|---|---|---|',
  ...rows,
  '',
].join('\n');
console.log(md);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);

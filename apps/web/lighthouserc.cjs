// Lighthouse CI: runs on GitHub Actions against the production build (see .github/workflows/ci.yml).
// LHCI_COOKIE holds a demo-user session so signed-in screens can be measured.
const cookie = process.env.LHCI_COOKIE ?? '';
const base = process.env.LHCI_BASE_URL ?? 'http://localhost:5180';

module.exports = {
  ci: {
    collect: {
      url: [`${base}/sign-in`, `${base}/today`, `${base}/tasks`],
      numberOfRuns: 3,
      settings: {
        // Default is mobile emulation with slow 4G + mid-tier CPU throttling.
        extraHeaders: cookie ? JSON.stringify({ Cookie: cookie }) : undefined,
        chromeFlags: '--no-sandbox',
      },
    },
    assert: {
      assertions: {
        'categories:accessibility': ['error', { minScore: 0.95 }],
        'categories:best-practices': ['error', { minScore: 0.9 }],
        // CI machines vary; performance is reported and warned on, not a hard failure.
        'categories:performance': ['warn', { minScore: 0.9 }],
      },
    },
    upload: { target: 'filesystem', outputDir: './lhci-report' },
  },
};

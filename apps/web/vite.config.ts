import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import { VitePWA } from 'vite-plugin-pwa';

const API = process.env.VITE_API_PROXY ?? 'http://localhost:3000';

/** Reads the "/*" block of public/_headers so `vite preview` serves the same security headers as Cloudflare. */
function productionHeaders(): Record<string, string> {
  const text = readFileSync(new URL('./public/_headers', import.meta.url), 'utf8');
  const block = text.split(/\n(?=\/)/).find((b) => b.trimStart().startsWith('/*')) ?? '';
  const out: Record<string, string> = {};
  for (const line of block.split('\n').slice(1)) {
    const m = line.match(/^\s+([\w-]+):\s*(.+)$/);
    if (m) out[m[1]!] = m[2]!.replace('; upgrade-insecure-requests', '');
  }
  delete out['Strict-Transport-Security'];
  return out;
}

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['icons/*.png', 'icons/favicon.svg', 'boot.js'],
      manifest: {
        id: '/',
        name: 'ToDo',
        short_name: 'ToDo',
        description: 'Shared tasks for families, offices and roommates.',
        start_url: '/today',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#F6F5F1',
        theme_color: '#2F6B5F',
        lang: 'en',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      // Our own service worker (src/sw.ts): app shell + web push + notification clicks.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png}'],
        // The password-strength dictionaries are large and only needed on sign-up/reset screens.
        globIgnores: ['**/password-*.js'],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: { '/api': { target: API, changeOrigin: false, xfwd: true } },
  },
  preview: {
    port: 4173,
    headers: productionHeaders(),
    proxy: { '/api': { target: API, changeOrigin: false, xfwd: true } },
  },
  // iPhones run every browser (Chrome too) on Safari's engine, and many are on iOS 14–16.3.
  // 'es2022' left class static blocks in the sign-in code, which those phones can't parse,
  // so Log in / Create account did nothing there. Newer APIs are polyfilled in lib/polyfills.ts.
  build: { sourcemap: true, target: ['es2020', 'safari14', 'chrome90', 'firefox90', 'edge90'] },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});

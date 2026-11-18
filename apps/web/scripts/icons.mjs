// Generates placeholder app icons from an SVG. Replace public/icons/source.svg with the real icon later.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';

const dir = new URL('../public/icons/', import.meta.url);
mkdirSync(dir, { recursive: true });
const svg = (pad) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="${pad ? 0 : 112}" fill="#2F6B5F"/>
  <path d="M150 268l72 72 140-160" fill="none" stroke="#fff" stroke-width="${pad ? 44 : 52}" stroke-linecap="round" stroke-linejoin="round" transform="${pad ? 'translate(51 51) scale(0.8)' : ''}"/>
</svg>`;
writeFileSync(new URL('favicon.svg', dir), svg(false));
const out = async (name, size, pad = false) =>
  writeFileSync(
    new URL(name, dir),
    await sharp(Buffer.from(svg(pad)))
      .resize(size, size)
      .png()
      .toBuffer(),
  );
await out('icon-192.png', 192);
await out('icon-512.png', 512);
await out('icon-maskable-512.png', 512, true);
await out('apple-touch-icon.png', 180, true);
console.warn('icons written', readFileSync(new URL('favicon.svg', dir)).length);

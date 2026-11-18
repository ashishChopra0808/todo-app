import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { toCss } from '../src/index';

const out = fileURLToPath(new URL('../tokens.css', import.meta.url));
writeFileSync(out, toCss());
console.warn(`wrote ${out}`);

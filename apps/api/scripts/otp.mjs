// Dev helper: prints the latest OTP codes from the file outbox.  pnpm --filter @todo/api otp
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.env.OUTBOX_DIR ?? '.outbox';
const files = (() => {
  try {
    return readdirSync(dir).sort().reverse().slice(0, 5);
  } catch {
    return [];
  }
})();
if (!files.length) console.log(`No messages in ${dir} yet.`);
for (const f of files) {
  const m = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  const code = m.code ?? (m.text?.match(/\b(\d{6})\b/) ?? [])[1];
  console.log(`${m.at}  ${m.kind.padEnd(5)}  ${m.to}  →  ${code ?? '(no code)'}  [${m.purpose}]`);
}

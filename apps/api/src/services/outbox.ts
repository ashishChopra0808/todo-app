import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { newId } from '../lib/ids';

/** Dev/test only: writes outgoing messages as JSON files so tests and developers can read OTPs. */
export async function writeOutbox(
  dir: string,
  kind: 'email' | 'sms',
  message: Record<string, unknown>,
) {
  await mkdir(dir, { recursive: true });
  const file = join(dir, `${Date.now()}-${kind}-${newId()}.json`);
  await writeFile(
    file,
    JSON.stringify({ kind, at: new Date().toISOString(), ...message }, null, 2),
  );
}

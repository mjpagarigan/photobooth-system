import { readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

import { USER_DATA_LEDGER, evidenceDir, removeUserData } from './harness';

export default async function teardown(): Promise<void> {
  const ledger = resolve(evidenceDir(), USER_DATA_LEDGER);
  const listed = await readFile(ledger, 'utf8').catch(() => '');
  for (const directory of listed.split('\n').filter(Boolean)) {
    await removeUserData(directory);
  }
  await rm(ledger, { force: true });
}

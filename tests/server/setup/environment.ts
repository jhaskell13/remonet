import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll } from 'vitest';

// Runs before every server test file, inside that file's isolated worker. `server/config.ts` reads
// the environment once at import time, so everything the API needs must be in place here, before
// any server module is imported. Each file gets its own SQLite database so files can run in parallel.
const directory = mkdtempSync(join(tmpdir(), 'remonet-test-'));

process.env.NODE_ENV = 'test';
process.env.REMONET_DB_PATH = join(directory, 'remonet.sqlite');
process.env.REMONET_ALLOWED_ORIGIN = 'http://127.0.0.1:5173';
process.env.REMONET_APP_ORIGIN = 'http://127.0.0.1:5173';
process.env.REMONET_SEED_DEMO = 'false';
process.env.REMONET_API_TOKEN = 'integration-token-for-tests-0123456789abcdef';
process.env.REMONET_API_ORGANIZATION_IDS = 'org-demo';
for (const name of Object.keys(process.env)) {
  if (name.startsWith('REMONET_BOOTSTRAP_')) delete process.env[name];
}

afterAll(async () => {
  const { closeDatabase } = await import('../../../server/persistence/database.ts');
  closeDatabase();
  rmSync(directory, { recursive: true, force: true });
});

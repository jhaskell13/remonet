import { describe, expect, it, vi } from 'vitest';

// `node:fs` is mocked for this file only so the runner can be fed a directory listing with a gap.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    readdirSync: vi.fn((path: string) =>
      actual.readdirSync(path).filter((entry) => !entry.startsWith('002_')),
    ),
  };
});

describe('migration runner: sequence guard', () => {
  it('refuses to start when migration numbers are not continuous', async () => {
    const { migrateDatabase } = await import('../../../server/persistence/database.ts');
    expect(() => migrateDatabase()).toThrow(
      'Database migrations must use a continuous sequence starting at 001',
    );
  });
});

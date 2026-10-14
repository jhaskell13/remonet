import { beforeAll } from 'vitest';
import { db, migrateDatabase } from '../../../server/persistence/database.ts';
import { seedTestData } from './fixtures.ts';
import { useTransactionPerTest } from './transaction.ts';

export type SqliteError = Error & { code?: string };

// Seeding happens once per test file even when several `describe` blocks call the helper.
let seeded = false;

/** Migrates and seeds the file's private database without starting the HTTP layer. */
export function useSeededDatabase() {
  beforeAll(() => {
    if (seeded) return;
    migrateDatabase();
    seedTestData();
    seeded = true;
  });
  useTransactionPerTest();
  return db;
}

export function count(table: string, whereClause = '', ...values: unknown[]) {
  return (
    db.prepare(`SELECT COUNT(*) AS count FROM ${table} ${whereClause}`).get(...values) as { count: number }
  ).count;
}

/** Runs `fn` and returns the SQLite error code it throws, or undefined when it succeeds. */
export function sqliteErrorCode(fn: () => unknown) {
  try {
    fn();
    return undefined;
  } catch (error) {
    return (error as SqliteError).code ?? (error as Error).message;
  }
}

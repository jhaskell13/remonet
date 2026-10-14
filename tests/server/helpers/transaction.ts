import { afterEach, beforeEach } from 'vitest';
import { db } from '../../../server/persistence/database.ts';

/**
 * Opens a transaction before each test and rolls it back afterwards so every test starts from the
 * seeded state. Application code that uses `db.transaction()` nests as a savepoint, so its real
 * commit and rollback paths still execute inside the outer transaction.
 */
export function useTransactionPerTest() {
  beforeEach(() => {
    if (db.inTransaction) db.exec('ROLLBACK');
    db.exec('BEGIN');
  });
  afterEach(() => {
    if (db.inTransaction) db.exec('ROLLBACK');
  });
}

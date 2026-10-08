import { IDatabaseRepository } from './repository.interface';
import { PostgresRepository } from './postgres-repository';
import { InMemoryRepository } from './in-memory-repository';
import { isPostgresConnected, getDbPool, closeDbPool, closePostgresPool, runMigrations } from './db-client';

const inMemoryRepository = new InMemoryRepository();
const postgresRepository = new PostgresRepository();

let isPostgresAvailable = false;

/**
 * Initializes the database layer and checks for live PostgreSQL connectivity.
 */
export async function initDatabase(): Promise<{ isPostgres: boolean }> {
  if (process.env.DATABASE_URL) {
    isPostgresAvailable = await isPostgresConnected();
    if (isPostgresAvailable) {
      await runMigrations();
      return { isPostgres: true };
    }
  }
  isPostgresAvailable = false;
  return { isPostgres: false };
}

/**
 * Dynamic Proxy Repository:
 * Dispatches every operation in real-time to PostgresRepository when PostgreSQL is available,
 * or safely falls back to InMemoryRepository if offline or in local development.
 * Guarantees zero stale reference issues even if initialized before initDatabase() completes.
 */
const dynamicRepository = new Proxy({} as IDatabaseRepository, {
  get(_target, prop) {
    const targetRepo = (isPostgresAvailable && process.env.DATABASE_URL)
      ? postgresRepository
      : inMemoryRepository;
    const value = (targetRepo as any)[prop];
    if (typeof value === 'function') {
      return value.bind(targetRepo);
    }
    return value;
  },
});

/**
 * Repository Factory / Singleton Provider:
 * Returns the dynamic delegating repository singleton.
 */
export function getDatabaseRepository(): IDatabaseRepository {
  return dynamicRepository;
}

export {
  IDatabaseRepository,
  PostgresRepository,
  InMemoryRepository,
  isPostgresConnected,
  getDbPool,
  closeDbPool,
  closePostgresPool,
  runMigrations,
};

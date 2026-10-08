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
 * Repository Factory / Singleton Provider:
 * Dynamically delegates to PostgresRepository when DATABASE_URL is active and verified,
 * or safely falls back to InMemoryRepository for local development or offline mode.
 */
export function getDatabaseRepository(): IDatabaseRepository {
  if (isPostgresAvailable && process.env.DATABASE_URL) {
    return postgresRepository;
  }
  return inMemoryRepository;
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

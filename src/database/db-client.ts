import { Pool, PoolConfig } from 'pg';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

let pool: Pool | null = null;

export function getDbPool(): Pool | null {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    return null;
  }

  if (!pool) {
    const config: PoolConfig = {
      connectionString,
      ssl: process.env.NODE_ENV === 'production' || connectionString.includes('supabase')
        ? { rejectUnauthorized: false }
        : undefined,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    };

    pool = new Pool(config);

    pool.on('error', (err) => {
      console.error('[PostgreSQL] Unexpected error on idle client:', err.message);
    });
  }

  return pool;
}

export async function isPostgresConnected(): Promise<boolean> {
  const p = getDbPool();
  if (!p) return false;
  try {
    const res = await p.query('SELECT NOW()');
    return !!res.rows[0];
  } catch (err: any) {
    console.warn('[PostgreSQL] Connection check failed:', err.message);
    return false;
  }
}

export async function runMigrations(): Promise<{ success: boolean; message: string }> {
  const p = getDbPool();
  if (!p) {
    return {
      success: false,
      message: 'DATABASE_URL is not set in environment. Skipping PostgreSQL migrations.',
    };
  }

  try {
    const schemaPath = path.join(__dirname, 'schema.sql');
    if (!fs.existsSync(schemaPath)) {
      throw new Error(`Schema file not found at: ${schemaPath}`);
    }

    const sql = fs.readFileSync(schemaPath, 'utf8');
    console.log('[PostgreSQL] Running PostGIS migrations on Supabase/Postgres...');
    await p.query(sql);
    console.log('[PostgreSQL] ✅ PostGIS extensions and tables created successfully!');
    return { success: true, message: 'Migrations completed successfully.' };
  } catch (err: any) {
    console.error('[PostgreSQL] ❌ Migration failed:', err.message);
    return { success: false, message: err.message };
  }
}

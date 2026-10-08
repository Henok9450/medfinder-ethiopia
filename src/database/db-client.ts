import { Pool, PoolConfig } from 'pg';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
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

import { SCHEMA_SQL } from './schema-sql';

export async function runMigrations(): Promise<{ success: boolean; message: string }> {
  const p = getDbPool();
  if (!p) {
    return {
      success: false,
      message: 'DATABASE_URL is not set in environment. Skipping PostgreSQL migrations.',
    };
  }

  try {
    const candidatePaths = [
      path.join(__dirname, 'schema.sql'),
      path.join(__dirname, '../src/database/schema.sql'),
      path.join(process.cwd(), 'src/database/schema.sql'),
      path.join(process.cwd(), 'dist/database/schema.sql'),
    ];

    let sql = SCHEMA_SQL;
    for (const pth of candidatePaths) {
      if (fs.existsSync(pth)) {
        sql = fs.readFileSync(pth, 'utf8');
        break;
      }
    }

    console.log('[PostgreSQL] Running PostGIS migrations on Supabase/Postgres...');
    await p.query(sql);
    console.log('[PostgreSQL] ✅ PostGIS extensions and tables created successfully!');

    // Ensure default master admin exists
    const defaultUsername = 'admin';
    const defaultPassword = process.env.ADMIN_DEFAULT_PASSWORD || 'Admin@MedFinder2026!';
    const passwordHash = crypto.createHash('sha256').update(defaultPassword + '_medfinder_ethiopia_salt').digest('hex');
    const privileges = JSON.stringify({
      canReviewApplications: true,
      canManagePolicies: true,
      canImposeSanctions: true,
      canManageAdmins: true,
      canViewAuditLogs: true,
    });

    await p.query(
      `INSERT INTO admin_users (id, username, full_name, email, role, privileges, password_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (username) DO NOTHING`,
      ['adm-super-01', defaultUsername, 'Chief Regulatory Administrator (EFDA)', 'admin@efda.gov.et', 'SUPER_ADMIN', privileges, passwordHash]
    );
    console.log('[PostgreSQL] ✅ Master admin user verified/seeded!');

    return { success: true, message: 'Migrations completed successfully.' };
  } catch (err: any) {
    console.error('[PostgreSQL] ❌ Migration failed:', err.message);
    return { success: false, message: err.message };
  }
}

export async function closeDbPool(): Promise<void> {
  if (pool) {
    try {
      await pool.end();
      console.log('[PostgreSQL] Connection pool closed gracefully.');
    } catch (err: any) {
      console.error('[PostgreSQL] Error closing pool:', err.message);
    } finally {
      pool = null;
    }
  }
}

export const closePostgresPool = closeDbPool;



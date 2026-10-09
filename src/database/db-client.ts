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

    // Ensure reservation acknowledgment columns exist
    await p.query(`
      ALTER TABLE reservations ADD COLUMN IF NOT EXISTS pharmacist_acknowledged BOOLEAN DEFAULT FALSE;
      ALTER TABLE reservations ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ;
    `);

    // Ensure portal credential columns exist on pharmacy_verification_applications
    await p.query(`
      ALTER TABLE pharmacy_verification_applications ADD COLUMN IF NOT EXISTS approved_pharmacy_id TEXT;
      ALTER TABLE pharmacy_verification_applications ADD COLUMN IF NOT EXISTS portal_username TEXT;
      ALTER TABLE pharmacy_verification_applications ADD COLUMN IF NOT EXISTS portal_temp_password TEXT;
      ALTER TABLE pharmacy_verification_applications ADD COLUMN IF NOT EXISTS portal_setup_token TEXT;
    `);

    // Ensure pharmacy_portal_accounts table exists
    await p.query(`
      CREATE TABLE IF NOT EXISTS pharmacy_portal_accounts (
        id TEXT PRIMARY KEY,
        pharmacy_id TEXT REFERENCES pharmacies(id) ON DELETE CASCADE,
        pharmacy_name TEXT NOT NULL,
        sub_city TEXT NOT NULL,
        phone TEXT NOT NULL,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        temp_password TEXT,
        setup_token TEXT,
        setup_token_expires_at TIMESTAMPTZ,
        must_change_password BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        last_login_at TIMESTAMPTZ,
        session_token TEXT
      );
    `);

    // Backfill any approved applications missing portal credentials
    try {
      const uncredentialed = await p.query(`
        SELECT id, pharmacy_name, sub_city, phone, efda_license_number, approved_pharmacy_id, portal_username, portal_temp_password, portal_setup_token
        FROM pharmacy_verification_applications
        WHERE status = 'APPROVED' AND (portal_username IS NULL OR portal_setup_token IS NULL)
      `);

      for (const row of uncredentialed.rows) {
        const cleanName = (row.pharmacy_name || 'pharm')
          .toLowerCase()
          .replace(/[^a-z0-9]/g, '_')
          .replace(/_+/g, '_')
          .replace(/^_|_$/g, '');
        const randNum = Math.floor(100 + Math.random() * 900);
        const baseUsername = cleanName ? `${cleanName.substring(0, 15)}_${randNum}` : `pharm_${randNum}`;
        const tempCode = Math.floor(1000 + Math.random() * 9000);
        const tempPassword = `Med#${tempCode}!ET`;
        const passHash = crypto.createHash('sha256').update(tempPassword + '_medfinder_ethiopia_salt').digest('hex');
        const setupTok = crypto.randomBytes(16).toString('hex');
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7-day validity for backfilled setup link
        const accId = `acc-${crypto.randomBytes(4).toString('hex')}`;
        const pId = row.approved_pharmacy_id || `pharm-${(row.sub_city || 'bole').toLowerCase().replace(/[^a-z]/g, '')}-${Math.floor(1000 + Math.random() * 9000)}`;

        // Ensure parent pharmacy record exists in pharmacies table to satisfy foreign key constraint
        await p.query(
          `INSERT INTO pharmacies (id, name, sub_city, phone, efda_license_number, tin_number, is_verified, location)
           VALUES ($1, $2, $3, $4, $5, $6, TRUE, ST_SetSRID(ST_MakePoint(38.7880, 8.9950), 4326))
           ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, is_verified = TRUE`,
          [pId, row.pharmacy_name, row.sub_city || 'Bole', row.phone, row.efda_license_number || 'EFDA/PH/2026', 'TIN-00000000']
        );

        await p.query(
          `INSERT INTO pharmacy_portal_accounts (
             id, pharmacy_id, pharmacy_name, sub_city, phone, username,
             password_hash, temp_password, setup_token, setup_token_expires_at,
             must_change_password, created_at
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, TRUE, NOW())
           ON CONFLICT (username) DO UPDATE
           SET temp_password = EXCLUDED.temp_password, setup_token = EXCLUDED.setup_token`,
          [accId, pId, row.pharmacy_name, row.sub_city, row.phone, baseUsername, passHash, tempPassword, setupTok, expiresAt]
        );

        await p.query(
          `UPDATE pharmacy_verification_applications
           SET approved_pharmacy_id = $1, portal_username = $2, portal_temp_password = $3, portal_setup_token = $4
           WHERE id = $5`,
          [pId, baseUsername, tempPassword, setupTok, row.id]
        );
        console.log(`[PostgreSQL] ✅ Backfilled portal credentials for approved pharmacy: ${row.pharmacy_name} (${baseUsername})`);
      }
    } catch (backfillErr: any) {
      console.warn('[PostgreSQL] Portal credentials backfill notice:', backfillErr.message);
    }

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



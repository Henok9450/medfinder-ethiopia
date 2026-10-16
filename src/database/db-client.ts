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

    // Ensure reservation columns exist
    await p.query(`
      ALTER TABLE reservations ADD COLUMN IF NOT EXISTS pharmacist_acknowledged BOOLEAN DEFAULT FALSE;
      ALTER TABLE reservations ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ;
      ALTER TABLE reservations ADD COLUMN IF NOT EXISTS patient_phone TEXT;
      ALTER TABLE reservations ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
      ALTER TABLE reservations ADD COLUMN IF NOT EXISTS cancelled_by TEXT;
      ALTER TABLE reservations ADD COLUMN IF NOT EXISTS reason TEXT;
    `);

    // Ensure passwordless portal columns exist on pharmacy_verification_applications
    await p.query(`
      ALTER TABLE pharmacy_verification_applications ADD COLUMN IF NOT EXISTS approved_pharmacy_id TEXT;
      ALTER TABLE pharmacy_verification_applications ADD COLUMN IF NOT EXISTS portal_access_key TEXT;
      ALTER TABLE pharmacy_verification_applications ADD COLUMN IF NOT EXISTS portal_username TEXT;
      ALTER TABLE pharmacy_verification_applications ADD COLUMN IF NOT EXISTS portal_temp_password TEXT;
      ALTER TABLE pharmacy_verification_applications ADD COLUMN IF NOT EXISTS portal_setup_token TEXT;
    `);

    // Ensure pharmacy_portal_accounts table exists with passwordless columns
    await p.query(`
      CREATE TABLE IF NOT EXISTS pharmacy_portal_accounts (
        id TEXT PRIMARY KEY,
        pharmacy_id TEXT REFERENCES pharmacies(id) ON DELETE CASCADE,
        pharmacy_name TEXT NOT NULL,
        sub_city TEXT NOT NULL,
        phone TEXT NOT NULL,
        access_key TEXT,
        telegram_chat_id TEXT,
        session_expires_at TIMESTAMPTZ,
        last_otp_code TEXT,
        last_otp_expires_at TIMESTAMPTZ,
        username TEXT,
        password_hash TEXT,
        temp_password TEXT,
        setup_token TEXT,
        setup_token_expires_at TIMESTAMPTZ,
        must_change_password BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        last_login_at TIMESTAMPTZ,
        session_token TEXT
      );

      ALTER TABLE pharmacy_portal_accounts ADD COLUMN IF NOT EXISTS access_key TEXT;
      ALTER TABLE pharmacy_portal_accounts ADD COLUMN IF NOT EXISTS telegram_chat_id TEXT;
      ALTER TABLE pharmacy_portal_accounts ADD COLUMN IF NOT EXISTS session_expires_at TIMESTAMPTZ;
      ALTER TABLE pharmacy_portal_accounts ADD COLUMN IF NOT EXISTS last_otp_code TEXT;
      ALTER TABLE pharmacy_portal_accounts ADD COLUMN IF NOT EXISTS last_otp_expires_at TIMESTAMPTZ;
      ALTER TABLE pharmacy_portal_accounts ALTER COLUMN password_hash DROP NOT NULL;
      ALTER TABLE pharmacy_portal_accounts ALTER COLUMN username DROP NOT NULL;
    `);

    // Ensure analytics_access column on pharmacies and search_analytics_events table exist
    await p.query(`
      ALTER TABLE pharmacies ADD COLUMN IF NOT EXISTS analytics_access JSONB DEFAULT '{"enabled": false, "tier": "BASIC"}'::jsonb;
      
      CREATE TABLE IF NOT EXISTS search_analytics_events (
        id TEXT PRIMARY KEY,
        query TEXT NOT NULL,
        normalized_drug TEXT NOT NULL,
        core_brand_or_generic TEXT NOT NULL,
        sub_city TEXT NOT NULL,
        city TEXT NOT NULL DEFAULT 'Addis Ababa',
        matched_count INTEGER NOT NULL DEFAULT 0,
        user_id TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_search_analytics_created ON search_analytics_events (created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_search_analytics_drug_subcity ON search_analytics_events (normalized_drug, sub_city);

      CREATE TABLE IF NOT EXISTS patient_devices (
        device_id TEXT PRIMARY KEY,
        verified_phone TEXT NOT NULL,
        telegram_user_id TEXT,
        telegram_username TEXT,
        carrier TEXT,
        is_trusted BOOLEAN DEFAULT TRUE,
        trusted_at TIMESTAMPTZ DEFAULT NOW(),
        last_seen_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_patient_devices_phone ON patient_devices (verified_phone);
      CREATE INDEX IF NOT EXISTS idx_patient_devices_telegram ON patient_devices (telegram_user_id);
    `);

    // Backfill any approved applications missing passwordless portal access keys
    try {
      await p.query(`
        UPDATE pharmacy_portal_accounts
        SET access_key = COALESCE(setup_token, 'mf_key_' || md5(random()::text || id))
        WHERE access_key IS NULL OR access_key = ''
      `);

      const uncredentialed = await p.query(`
        SELECT id, telegram_chat_id, pharmacy_name, sub_city, phone, efda_license_number, approved_pharmacy_id, portal_access_key, portal_username, portal_setup_token
        FROM pharmacy_verification_applications
        WHERE status = 'APPROVED' AND (portal_access_key IS NULL OR portal_setup_token IS NULL)
      `);

      for (const row of uncredentialed.rows) {
        const accessKey = row.portal_access_key || row.portal_setup_token || ('mf_key_' + crypto.randomBytes(24).toString('hex'));
        const sessionToken = 'sess_' + crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000);
        const accId = `acc-${crypto.randomBytes(6).toString('hex')}`;
        const pId = row.approved_pharmacy_id || `pharm-${(row.sub_city || 'bole').toLowerCase().replace(/[^a-z]/g, '')}-${Math.floor(1000 + Math.random() * 9000)}`;

        // Ensure parent pharmacy record exists in pharmacies table to satisfy foreign key constraint
        await p.query(
          `INSERT INTO pharmacies (id, name, sub_city, phone, telegram_chat_id, efda_license_number, tin_number, is_verified, location)
           VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, ST_SetSRID(ST_MakePoint(38.7880, 8.9950), 4326))
           ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, is_verified = TRUE, telegram_chat_id = COALESCE(pharmacies.telegram_chat_id, EXCLUDED.telegram_chat_id)`,
          [pId, row.pharmacy_name, row.sub_city || 'Bole', row.phone, row.telegram_chat_id, row.efda_license_number || 'EFDA/PH/2026', 'TIN-00000000']
        );

        const existingAcc = await p.query(
          `SELECT id, access_key FROM pharmacy_portal_accounts WHERE pharmacy_id = $1 OR telegram_chat_id = $2 LIMIT 1`,
          [pId, row.telegram_chat_id]
        );

        let finalKey = accessKey;
        if (existingAcc.rows.length > 0) {
          finalKey = existingAcc.rows[0].access_key || accessKey;
          await p.query(
            `UPDATE pharmacy_portal_accounts SET access_key = $1, telegram_chat_id = COALESCE(telegram_chat_id, $2) WHERE id = $3`,
            [finalKey, row.telegram_chat_id, existingAcc.rows[0].id]
          );
        } else {
          await p.query(
            `INSERT INTO pharmacy_portal_accounts (
               id, pharmacy_id, pharmacy_name, sub_city, phone,
               access_key, telegram_chat_id, session_token, session_expires_at, created_at
             )
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
            [accId, pId, row.pharmacy_name, row.sub_city || 'Bole', row.phone, finalKey, row.telegram_chat_id, sessionToken, expiresAt]
          );
        }

        await p.query(
          `UPDATE pharmacy_verification_applications
           SET approved_pharmacy_id = $1, portal_access_key = $2, portal_username = $2, portal_setup_token = $2
           WHERE id = $3`,
          [pId, finalKey, row.id]
        );
        console.log(`[PostgreSQL] ✅ Backfilled 1-Click Magic Key for approved pharmacy: ${row.pharmacy_name}`);
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

    // Seed initial search analytics telemetry if table is empty
    try {
      const evCountRes = await p.query('SELECT COUNT(*) FROM search_analytics_events');
      if (parseInt(evCountRes.rows[0]?.count || '0', 10) === 0) {
        const seedTelemetry = [
          { q: 'Ventolin Inhaler 100mcg', d: 'ventolin', s: 'Bole', c: 48, m: 1 },
          { q: 'Ventolin Evohaler', d: 'ventolin', s: 'Kirkos', c: 24, m: 1 },
          { q: 'Insulin Humulin N', d: 'insulin', s: 'Bole', c: 36, m: 2 },
          { q: 'Augmentin 625mg', d: 'augmentin', s: 'Bole', c: 31, m: 2 },
          { q: 'Eltroxin 100mcg', d: 'eltroxin', s: 'Bole', c: 42, m: 0 },
          { q: 'Eltroxin 50mcg', d: 'eltroxin', s: 'Yeka', c: 28, m: 0 },
          { q: 'Ceftriaxone 1g', d: 'ceftriaxone', s: 'Kirkos', c: 19, m: 1 },
          { q: 'Metformin 850mg', d: 'metformin', s: 'Bole', c: 25, m: 2 },
          { q: 'Amlodipine 10mg', d: 'amlodipine', s: 'Bole', c: 18, m: 2 },
          { q: 'Paracetamol 500mg', d: 'paracetamol', s: 'Bole', c: 15, m: 3 },
        ];

        for (const item of seedTelemetry) {
          for (let i = 0; i < item.c; i++) {
            const evId = `ev-${crypto.randomBytes(4).toString('hex')}`;
            const daysAgo = Math.floor(Math.random() * 7);
            await p.query(
              `INSERT INTO search_analytics_events (id, query, normalized_drug, core_brand_or_generic, sub_city, city, matched_count, user_id, created_at)
               VALUES ($1, $2, $3, $4, $5, 'Addis Ababa', $6, $7, NOW() - ($8 || ' days')::interval)`,
              [evId, item.q, item.d, item.d, item.s, item.m, `patient_${Math.floor(1000 + Math.random() * 9000)}`, daysAgo]
            );
          }
        }
        console.log('[PostgreSQL] ✅ Baseline demand intelligence telemetry seeded!');
      }
    } catch (seedEvErr: any) {
      console.warn('[PostgreSQL] Telemetry seed notice:', seedEvErr.message);
    }

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



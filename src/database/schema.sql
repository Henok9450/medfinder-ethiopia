-- ==============================================================================
-- MedFinder Ethiopia - PostgreSQL & PostGIS Schema for Supabase
-- ==============================================================================

-- 1. Enable PostGIS Extension for Geolocation Spatial Queries
CREATE EXTENSION IF NOT EXISTS postgis;

-- 2. Pharmacies Table
CREATE TABLE IF NOT EXISTS pharmacies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sub_city TEXT NOT NULL,
  city TEXT NOT NULL DEFAULT 'Addis Ababa',
  phone TEXT NOT NULL,
  address TEXT,
  telegram_chat_id TEXT,
  is_verified BOOLEAN DEFAULT FALSE,
  efda_license_number TEXT NOT NULL,
  tin_number TEXT NOT NULL,
  tier TEXT DEFAULT 'BASIC' CHECK (tier IN ('BASIC', 'PREMIUM')),
  trust_score INTEGER DEFAULT 100 CHECK (trust_score BETWEEN 0 AND 100),
  strike_count INTEGER DEFAULT 0 CHECK (strike_count BETWEEN 0 AND 3),
  is_shadow_banned BOOLEAN DEFAULT FALSE,
  shadow_ban_until TIMESTAMPTZ,
  is_permanently_banned BOOLEAN DEFAULT FALSE,
  in_stock_items TEXT[] DEFAULT ARRAY[]::TEXT[],
  inventory JSONB DEFAULT '[]'::jsonb,
  analytics_access JSONB DEFAULT '{"enabled": false, "tier": "BASIC"}'::jsonb,
  -- Spatial location using PostGIS geography point (Longitude, Latitude)
  location GEOGRAPHY(Point, 4326) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Spatial GIST index for high-speed radius distance matching
CREATE INDEX IF NOT EXISTS idx_pharmacies_location ON pharmacies USING GIST (location);
CREATE INDEX IF NOT EXISTS idx_pharmacies_verified ON pharmacies (is_verified, is_permanently_banned);

-- 3. Patient Search & Broadcast Requests
CREATE TABLE IF NOT EXISTS broadcast_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  medicine_name TEXT NOT NULL,
  user_location GEOGRAPHY(Point, 4326) NOT NULL,
  current_radius_km NUMERIC(5,2) DEFAULT 3.5,
  pinged_pharmacy_ids TEXT[] DEFAULT ARRAY[]::TEXT[],
  status TEXT DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'FULFILLED', 'EXPIRED')),
  responses JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_broadcast_user_location ON broadcast_requests USING GIST (user_location);

-- 4. 1-Hour Anti-Scam Price-Lock Reservations
CREATE TABLE IF NOT EXISTS reservations (
  reservation_code TEXT PRIMARY KEY,
  patient_user_id TEXT NOT NULL,
  pharmacy_id TEXT REFERENCES pharmacies(id) ON DELETE CASCADE,
  pharmacy_name TEXT NOT NULL,
  medicine_name TEXT NOT NULL,
  locked_price_etb NUMERIC(10,2) NOT NULL,
  phone TEXT NOT NULL,
  status TEXT DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'FULFILLED', 'CANCELLED', 'DISPUTED', 'EXPIRED')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_reservations_status ON reservations (status, expires_at);

-- 5. User Subscriptions & Quotas
CREATE TABLE IF NOT EXISTS user_subscriptions (
  user_id TEXT PRIMARY KEY,
  plan TEXT DEFAULT 'FREE_TIER',
  active BOOLEAN DEFAULT FALSE,
  starts_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT TO_TIMESTAMP(0),
  monthly_searches_used INTEGER DEFAULT 0,
  last_search_month TEXT NOT NULL
);

-- 6. Telebirr Payment Invoices
CREATE TABLE IF NOT EXISTS payment_invoices (
  invoice_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  amount_etb NUMERIC(10,2) NOT NULL,
  purpose TEXT NOT NULL,
  status TEXT DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PAID', 'EXPIRED', 'FAILED')),
  telebirr_order_no TEXT,
  telebirr_transaction_no TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  paid_at TIMESTAMPTZ
);

-- 7. Pharmacy Violation & Fraud Reports (3-Strike System)
CREATE TABLE IF NOT EXISTS violation_reports (
  id TEXT PRIMARY KEY,
  patient_user_id TEXT NOT NULL,
  pharmacy_id TEXT REFERENCES pharmacies(id) ON DELETE CASCADE,
  pharmacy_name TEXT NOT NULL,
  medicine_name TEXT NOT NULL,
  issue_type TEXT NOT NULL,
  description TEXT,
  reported_at TIMESTAMPTZ DEFAULT NOW(),
  strike_applied BOOLEAN DEFAULT FALSE,
  new_trust_score INTEGER NOT NULL
);

-- 8. EFDA License Pharmacy Verification Applications
CREATE TABLE IF NOT EXISTS pharmacy_verification_applications (
  id TEXT PRIMARY KEY,
  telegram_chat_id TEXT NOT NULL,
  telegram_username TEXT,
  pharmacy_name TEXT NOT NULL,
  sub_city TEXT NOT NULL,
  address_details TEXT,
  location GEOGRAPHY(Point, 4326),
  gps_location_verified BOOLEAN DEFAULT FALSE,
  phone TEXT NOT NULL,
  pharmacist_name TEXT NOT NULL,
  pharmacist_license_number TEXT NOT NULL,
  efda_license_number TEXT NOT NULL,
  tin_number TEXT NOT NULL,
  counter_photo_url TEXT,
  efda_doc_url TEXT,
  status TEXT DEFAULT 'PENDING_REVIEW' CHECK (status IN ('PENDING_REVIEW', 'APPROVED', 'REJECTED', 'INFO_REQUESTED', 'RESUBMITTED')),
  admin_notes TEXT,
  requested_info_reason TEXT,
  resubmitted_at TIMESTAMPTZ,
  pharmacist_update_note TEXT,
  submitted_at TIMESTAMPTZ DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  approved_pharmacy_id TEXT,
  portal_username TEXT,
  portal_temp_password TEXT,
  portal_setup_token TEXT
);

-- 9. Admin Portal Accounts
CREATE TABLE IF NOT EXISTS admin_users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL,
  privileges JSONB NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_login_at TIMESTAMPTZ,
  session_token TEXT
);

-- 10. Pharmacy Portal Accounts
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

-- 11. Search Telemetry & Demand Intelligence Events
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


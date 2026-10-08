import crypto from 'crypto';
import { getDbPool } from './db-client';
import { IDatabaseRepository } from './repository.interface';
import {
  Pharmacy,
  ReservationHold,
  PharmacyVerificationApplication,
  PharmacyPortalAccount,
  AdminUser,
  InMemoryDatabase,
} from './in-memory-db';
import { UserSubscription } from '../monetization/subscription.types';

export class PostgresRepository implements IDatabaseRepository {
  private hashPassword(password: string): string {
    return InMemoryDatabase.hashPassword(password);
  }

  private mapPharmacyRow(r: any): Pharmacy & { distanceKm?: number } {
    return {
      id: r.id,
      name: r.name,
      subCity: r.subCity || r.sub_city,
      city: r.city,
      latitude: parseFloat(r.latitude),
      longitude: parseFloat(r.longitude),
      phone: r.phone,
      address: r.address || undefined,
      telegramChatId: r.telegramChatId || r.telegram_chat_id || undefined,
      isVerified: Boolean(r.isVerified ?? r.is_verified),
      efdaLicenseNumber: r.efdaLicenseNumber || r.efda_license_number,
      tinNumber: r.tinNumber || r.tin_number,
      tier: r.tier || 'BASIC',
      trustScore: parseInt(r.trustScore ?? r.trust_score, 10) || 100,
      strikeCount: parseInt(r.strikeCount ?? r.strike_count, 10) || 0,
      isShadowBanned: Boolean(r.isShadowBanned ?? r.is_shadow_banned),
      shadowBanUntil: r.shadowBanUntil || r.shadow_ban_until ? new Date(r.shadowBanUntil || r.shadow_ban_until).toISOString() : undefined,
      isPermanentlyBanned: Boolean(r.isPermanentlyBanned ?? r.is_permanently_banned),
      inStockItems: Array.isArray(r.inStockItems || r.in_stock_items) ? (r.inStockItems || r.in_stock_items) : [],
      inventory: typeof r.inventory === 'string' ? JSON.parse(r.inventory) : r.inventory || [],
      distanceKm: r.distanceKm !== undefined ? parseFloat(r.distanceKm) : undefined,
    };
  }

  /**
   * Native PostGIS Geospatial Query: ST_DWithin and ST_Distance
   */
  public async searchPharmacies(
    medicineName: string,
    userLat: number,
    userLng: number,
    radiusKm: number = 5
  ): Promise<Array<Pharmacy & { distanceKm: number }>> {
    const pool = getDbPool();
    if (!pool) return [];

    const radiusMeters = radiusKm * 1000;
    const cleanMedicine = medicineName.trim().toLowerCase();

    let query = `
      SELECT 
        id,
        name,
        sub_city AS "subCity",
        city,
        phone,
        address,
        telegram_chat_id AS "telegramChatId",
        is_verified AS "isVerified",
        efda_license_number AS "efdaLicenseNumber",
        tin_number AS "tinNumber",
        tier,
        trust_score AS "trustScore",
        strike_count AS "strikeCount",
        is_shadow_banned AS "isShadowBanned",
        shadow_ban_until AS "shadowBanUntil",
        is_permanently_banned AS "isPermanentlyBanned",
        in_stock_items AS "inStockItems",
        inventory,
        ST_Y(location::geometry) AS latitude,
        ST_X(location::geometry) AS longitude,
        ROUND((ST_Distance(location, ST_MakePoint($1, $2)::geography) / 1000.0)::numeric, 2) AS "distanceKm"
      FROM pharmacies
      WHERE 
        is_verified = TRUE
        AND is_permanently_banned = FALSE
        AND is_shadow_banned = FALSE
        AND ST_DWithin(location, ST_MakePoint($1, $2)::geography, $3)
    `;

    const values: any[] = [userLng, userLat, radiusMeters];

    if (cleanMedicine) {
      values.push(`%${cleanMedicine}%`);
      query += ` AND (
        EXISTS (
          SELECT 1 FROM unnest(in_stock_items) item 
          WHERE LOWER(item) LIKE $${values.length}
        )
        OR EXISTS (
          SELECT 1 FROM jsonb_array_elements(inventory) inv
          WHERE LOWER(inv->>'name') LIKE $${values.length}
        )
      )`;
    }

    query += ` ORDER BY "trustScore" DESC, "distanceKm" ASC LIMIT 25;`;

    const res = await pool.query(query, values);
    return res.rows.map((r) => this.mapPharmacyRow(r) as Pharmacy & { distanceKm: number });
  }

  public async getPharmacyById(id: string): Promise<Pharmacy | null> {
    const pool = getDbPool();
    if (!pool) return null;

    const res = await pool.query(
      `SELECT 
        id, name, sub_city AS "subCity", city, phone, address,
        telegram_chat_id AS "telegramChatId", is_verified AS "isVerified",
        efda_license_number AS "efdaLicenseNumber", tin_number AS "tinNumber",
        tier, trust_score AS "trustScore", strike_count AS "strikeCount",
        is_shadow_banned AS "isShadowBanned", shadow_ban_until AS "shadowBanUntil",
        is_permanently_banned AS "isPermanentlyBanned",
        in_stock_items AS "inStockItems", inventory,
        ST_Y(location::geometry) AS latitude,
        ST_X(location::geometry) AS longitude
      FROM pharmacies WHERE id = $1`,
      [id]
    );

    if (res.rows.length === 0) return null;
    return this.mapPharmacyRow(res.rows[0]);
  }

  public async getAllPharmacies(): Promise<Pharmacy[]> {
    const pool = getDbPool();
    if (!pool) return [];

    const res = await pool.query(
      `SELECT 
        id, name, sub_city AS "subCity", city, phone, address,
        telegram_chat_id AS "telegramChatId", is_verified AS "isVerified",
        efda_license_number AS "efdaLicenseNumber", tin_number AS "tinNumber",
        tier, trust_score AS "trustScore", strike_count AS "strikeCount",
        is_shadow_banned AS "isShadowBanned", shadow_ban_until AS "shadowBanUntil",
        is_permanently_banned AS "isPermanentlyBanned",
        in_stock_items AS "inStockItems", inventory,
        ST_Y(location::geometry) AS latitude,
        ST_X(location::geometry) AS longitude
      FROM pharmacies ORDER BY created_at DESC`
    );

    return res.rows.map((r) => this.mapPharmacyRow(r));
  }

  public async createReservationHold(holdData: {
    patientUserId: string;
    pharmacyId: string;
    medicineName: string;
    lockedPriceETB: number;
    durationMinutes?: number;
  }): Promise<ReservationHold | null> {
    const pool = getDbPool();
    if (!pool) return null;

    const pharmacy = await this.getPharmacyById(holdData.pharmacyId);
    if (!pharmacy || pharmacy.isPermanentlyBanned) return null;

    const randomCode = Math.floor(1000 + Math.random() * 9000).toString();
    const duration = holdData.durationMinutes || 60;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + duration * 60 * 1000).toISOString();

    const query = `
      INSERT INTO reservations (
        reservation_code, patient_user_id, pharmacy_id, pharmacy_name,
        medicine_name, locked_price_etb, phone, status, created_at, expires_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'ACTIVE', $8, $9)
      RETURNING *;
    `;

    await pool.query(query, [
      randomCode,
      holdData.patientUserId,
      pharmacy.id,
      pharmacy.name,
      holdData.medicineName,
      holdData.lockedPriceETB,
      pharmacy.phone,
      now,
      expiresAt,
    ]);

    return {
      reservationCode: randomCode,
      patientUserId: holdData.patientUserId,
      pharmacyId: pharmacy.id,
      pharmacyName: pharmacy.name,
      medicineName: holdData.medicineName,
      lockedPriceETB: holdData.lockedPriceETB,
      phone: pharmacy.phone,
      status: 'ACTIVE',
      createdAt: now.toISOString(),
      expiresAt,
    };
  }

  public async getReservationHold(code: string): Promise<ReservationHold | null> {
    const pool = getDbPool();
    if (!pool) return null;

    const res = await pool.query(
      `SELECT * FROM reservations WHERE reservation_code = $1`,
      [code]
    );

    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      reservationCode: r.reservation_code,
      patientUserId: r.patient_user_id,
      pharmacyId: r.pharmacy_id,
      pharmacyName: r.pharmacy_name,
      medicineName: r.medicine_name,
      lockedPriceETB: parseFloat(r.locked_price_etb),
      phone: r.phone,
      status: r.status,
      createdAt: new Date(r.created_at).toISOString(),
      expiresAt: new Date(r.expires_at).toISOString(),
    };
  }

  public async verifyAndFulfillReservation(
    code: string
  ): Promise<{ success: boolean; message: string; reservation?: ReservationHold }> {
    const pool = getDbPool();
    if (!pool) return { success: false, message: 'Database offline' };

    const hold = await this.getReservationHold(code);
    if (!hold) return { success: false, message: 'Reservation code not found' };

    if (new Date() > new Date(hold.expiresAt)) {
      await pool.query(`UPDATE reservations SET status = 'EXPIRED' WHERE reservation_code = $1`, [code]);
      return { success: false, message: 'This reservation hold has expired (60-minute limit exceeded)' };
    }

    await pool.query(`UPDATE reservations SET status = 'FULFILLED' WHERE reservation_code = $1`, [code]);
    hold.status = 'FULFILLED';

    // Boost pharmacy trust score slightly on fulfillment
    await pool.query(
      `UPDATE pharmacies SET trust_score = LEAST(100, trust_score + 1) WHERE id = $1`,
      [hold.pharmacyId]
    );

    return {
      success: true,
      message: `Reservation #${code} verified successfully. Price locked at ${hold.lockedPriceETB} ETB.`,
      reservation: hold,
    };
  }

  public async updatePharmacyLocation(
    pharmacyId: string,
    lat: number,
    lng: number,
    subCity?: string,
    addressDetails?: string
  ): Promise<{ success: boolean; pharmacy?: Pharmacy; error?: string }> {
    const pool = getDbPool();
    if (!pool) return { success: false, error: 'Database offline' };

    const query = `
      UPDATE pharmacies
      SET 
        location = ST_SetSRID(ST_MakePoint($1, $2), 4326),
        sub_city = COALESCE($3, sub_city),
        address = COALESCE($4, address),
        updated_at = NOW()
      WHERE id = $5
      RETURNING 
        id, name, sub_city AS "subCity", city, phone, address,
        telegram_chat_id AS "telegramChatId", is_verified AS "isVerified",
        efda_license_number AS "efdaLicenseNumber", tin_number AS "tinNumber",
        tier, trust_score AS "trustScore", strike_count AS "strikeCount",
        is_shadow_banned AS "isShadowBanned", shadow_ban_until AS "shadowBanUntil",
        is_permanently_banned AS "isPermanentlyBanned",
        in_stock_items AS "inStockItems", inventory,
        ST_Y(location::geometry) AS latitude,
        ST_X(location::geometry) AS longitude;
    `;

    const res = await pool.query(query, [lng, lat, subCity || null, addressDetails || null, pharmacyId]);
    if (res.rows.length === 0) return { success: false, error: 'Pharmacy not found' };

    return { success: true, pharmacy: this.mapPharmacyRow(res.rows[0]) };
  }

  public async submitVerificationApplication(
    data: Omit<PharmacyVerificationApplication, 'id' | 'status' | 'submittedAt'>
  ): Promise<PharmacyVerificationApplication> {
    const pool = getDbPool();
    const id = `MF-VERIFY-${Math.floor(1000 + Math.random() * 9000)}`;
    const now = new Date().toISOString();

    if (pool) {
      const locPoint = data.longitude !== undefined && data.latitude !== undefined
        ? `ST_SetSRID(ST_MakePoint(${data.longitude}, ${data.latitude}), 4326)`
        : 'NULL';

      const query = `
        INSERT INTO pharmacy_verification_applications (
          id, telegram_chat_id, telegram_username, pharmacy_name, sub_city,
          address_details, location, gps_location_verified, phone,
          pharmacist_name, pharmacist_license_number, efda_license_number,
          tin_number, counter_photo_url, efda_doc_url, status, submitted_at
        )
        VALUES (
          $1, $2, $3, $4, $5,
          $6, ${locPoint}, $7, $8,
          $9, $10, $11,
          $12, $13, $14, 'PENDING_REVIEW', $15
        )
      `;

      await pool.query(query, [
        id,
        data.telegramChatId,
        data.telegramUsername || null,
        data.pharmacyName,
        data.subCity,
        data.addressDetails || null,
        Boolean(data.gpsLocationVerified),
        data.phone,
        data.pharmacistName,
        data.pharmacistLicenseNumber,
        data.efdaLicenseNumber,
        data.tinNumber,
        data.counterPhotoUrl || null,
        data.efdaDocUrl || null,
        now,
      ]);
    }

    return {
      id,
      status: 'PENDING_REVIEW',
      submittedAt: now,
      ...data,
    };
  }

  public async reviewVerificationApplication(
    id: string,
    status: 'APPROVED' | 'REJECTED' | 'INFO_REQUESTED',
    adminNotes?: string,
    efdaLicenseNumber?: string
  ): Promise<{
    success: boolean;
    application?: PharmacyVerificationApplication;
    pharmacy?: Pharmacy;
    error?: string;
  }> {
    const pool = getDbPool();
    if (!pool) return { success: false, error: 'Database offline' };

    const appRes = await pool.query(
      `SELECT *, ST_Y(location::geometry) as lat, ST_X(location::geometry) as lng 
       FROM pharmacy_verification_applications WHERE id = $1`,
      [id]
    );

    if (appRes.rows.length === 0) return { success: false, error: 'Application not found' };
    const appRow = appRes.rows[0];

    const finalEfda = efdaLicenseNumber?.trim() || appRow.efda_license_number;
    await pool.query(
      `UPDATE pharmacy_verification_applications 
       SET status = $1, admin_notes = $2, efda_license_number = $3, reviewed_at = NOW() 
       WHERE id = $4`,
      [status, adminNotes || null, finalEfda, id]
    );

    let createdPharm: Pharmacy | undefined;

    if (status === 'APPROVED') {
      const cleanSubCity = (appRow.sub_city || 'Bole').toLowerCase().replace(/[^a-z]/g, '') || 'bole';
      const pharmId = `pharm-${cleanSubCity}-${Math.floor(1000 + Math.random() * 9000)}`;
      const lat = appRow.lat !== null ? parseFloat(appRow.lat) : 9.01;
      const lng = appRow.lng !== null ? parseFloat(appRow.lng) : 38.76;

      const insertPharm = `
        INSERT INTO pharmacies (
          id, name, sub_city, city, phone, telegram_chat_id,
          is_verified, efda_license_number, tin_number, tier, trust_score,
          strike_count, is_shadow_banned, is_permanently_banned,
          in_stock_items, inventory, location, created_at
        )
        VALUES (
          $1, $2, $3, 'Addis Ababa', $4, $5,
          TRUE, $6, $7, 'PREMIUM', 98,
          0, FALSE, FALSE,
          $8, $9, ST_SetSRID(ST_MakePoint($10, $11), 4326), NOW()
        )
        ON CONFLICT (id) DO NOTHING
        RETURNING *;
      `;

      const initialItems = ['insulin', 'augmentin', 'amoxicillin', 'metformin', 'ventolin'];
      const initialInv = [
        { name: 'Insulin (Humulin N / Regular)', genericName: 'Human Insulin', category: 'Diabetes', priceETB: 440, inStock: true, updatedAt: new Date().toISOString() },
        { name: 'Augmentin 625mg / 1g', genericName: 'Amoxicillin + Clavulanic Acid', category: 'Antibiotics', priceETB: 380, inStock: true, updatedAt: new Date().toISOString() },
      ];

      const pRes = await pool.query(insertPharm, [
        pharmId,
        appRow.pharmacy_name,
        appRow.sub_city,
        appRow.phone,
        appRow.telegram_chat_id,
        finalEfda,
        appRow.tin_number,
        initialItems,
        JSON.stringify(initialInv),
        lng,
        lat,
      ]);

      if (pRes.rows.length > 0) {
        createdPharm = this.mapPharmacyRow({
          ...pRes.rows[0],
          latitude: lat,
          longitude: lng,
        });
      }
    }

    return {
      success: true,
      pharmacy: createdPharm,
      application: {
        id,
        telegramChatId: appRow.telegram_chat_id,
        telegramUsername: appRow.telegram_username,
        pharmacyName: appRow.pharmacy_name,
        subCity: appRow.sub_city,
        phone: appRow.phone,
        pharmacistName: appRow.pharmacist_name,
        pharmacistLicenseNumber: appRow.pharmacist_license_number,
        efdaLicenseNumber: finalEfda,
        tinNumber: appRow.tin_number,
        status,
        submittedAt: new Date(appRow.submitted_at).toISOString(),
      },
    };
  }

  public async authenticatePharmacy(
    username: string,
    password: string
  ): Promise<{ success: boolean; account?: PharmacyPortalAccount; token?: string; error?: string }> {
    const pool = getDbPool();
    if (!pool) return { success: false, error: 'Database offline' };

    const res = await pool.query(
      `SELECT * FROM pharmacy_portal_accounts WHERE LOWER(username) = LOWER($1)`,
      [username.trim()]
    );

    if (res.rows.length === 0) return { success: false, error: 'Invalid username or password' };
    const acc = res.rows[0];

    const hash = this.hashPassword(password);
    if (acc.password_hash !== hash) {
      return { success: false, error: 'Invalid username or password' };
    }

    const token = 'sess_' + crypto.randomBytes(16).toString('hex');
    await pool.query(
      `UPDATE pharmacy_portal_accounts SET session_token = $1, last_login_at = NOW() WHERE id = $2`,
      [token, acc.id]
    );

    return {
      success: true,
      token,
      account: {
        id: acc.id,
        pharmacyId: acc.pharmacy_id,
        pharmacyName: acc.pharmacy_name,
        subCity: acc.sub_city,
        phone: acc.phone,
        username: acc.username,
        passwordHash: acc.password_hash,
        mustChangePassword: Boolean(acc.must_change_password),
        createdAt: new Date(acc.created_at).toISOString(),
        sessionToken: token,
      },
    };
  }

  public async authenticateAdmin(
    username: string,
    password: string
  ): Promise<{ success: boolean; admin?: Omit<AdminUser, 'passwordHash'>; token?: string; error?: string }> {
    const pool = getDbPool();
    if (!pool) return { success: false, error: 'Database offline' };

    const res = await pool.query(
      `SELECT * FROM admin_users WHERE LOWER(username) = LOWER($1)`,
      [username.trim()]
    );

    if (res.rows.length === 0) return { success: false, error: 'Invalid administrator credentials' };
    const user = res.rows[0];

    const hash = this.hashPassword(password);
    if (user.password_hash !== hash) {
      return { success: false, error: 'Invalid administrator credentials' };
    }

    const token = 'adm_sess_' + crypto.randomBytes(16).toString('hex');
    await pool.query(
      `UPDATE admin_users SET session_token = $1, last_login_at = NOW() WHERE id = $2`,
      [token, user.id]
    );

    return {
      success: true,
      token,
      admin: {
        id: user.id,
        username: user.username,
        fullName: user.full_name,
        email: user.email,
        role: user.role,
        privileges: typeof user.privileges === 'string' ? JSON.parse(user.privileges) : user.privileges,
        createdAt: new Date(user.created_at).toISOString(),
        sessionToken: token,
      },
    };
  }

  public async getOrCreateSubscription(userId: string): Promise<UserSubscription> {
    const pool = getDbPool();
    const currentMonth = new Date().toISOString().substring(0, 7);

    if (pool) {
      const res = await pool.query(
        `SELECT * FROM user_subscriptions WHERE user_id = $1`,
        [userId]
      );

      if (res.rows.length > 0) {
        const sub = res.rows[0];
        let searchesUsed = sub.monthly_searches_used;
        if (sub.last_search_month !== currentMonth) {
          searchesUsed = 0;
          await pool.query(
            `UPDATE user_subscriptions SET monthly_searches_used = 0, last_search_month = $1 WHERE user_id = $2`,
            [currentMonth, userId]
          );
        }
        return {
          userId: sub.user_id,
          plan: sub.plan,
          active: Boolean(sub.active),
          startsAt: new Date(sub.starts_at).toISOString(),
          expiresAt: new Date(sub.expires_at).toISOString(),
          monthlySearchesUsed: searchesUsed,
          lastSearchMonth: currentMonth,
        };
      }

      await pool.query(
        `INSERT INTO user_subscriptions (user_id, plan, active, starts_at, expires_at, monthly_searches_used, last_search_month)
         VALUES ($1, 'FREE_TIER', FALSE, NOW(), TO_TIMESTAMP(0), 0, $2)
         ON CONFLICT (user_id) DO NOTHING;`,
        [userId, currentMonth]
      );
    }

    return {
      userId,
      plan: 'FREE_TIER',
      active: false,
      startsAt: new Date().toISOString(),
      expiresAt: new Date(0).toISOString(),
      monthlySearchesUsed: 0,
      lastSearchMonth: currentMonth,
    };
  }

  public async addOrUpdateMedicine(
    pharmacyId: string,
    item: { name: string; genericName?: string; category?: string; priceETB: number; inStock?: boolean }
  ): Promise<boolean> {
    const pool = getDbPool();
    if (!pool) return false;

    const pharmacy = await this.getPharmacyById(pharmacyId);
    if (!pharmacy || pharmacy.isPermanentlyBanned) return false;

    const inventory = [...pharmacy.inventory];
    const existingIndex = inventory.findIndex((i) => i.name.toLowerCase() === item.name.toLowerCase());
    const cleanLower = item.name.toLowerCase();

    if (existingIndex >= 0) {
      inventory[existingIndex] = {
        ...inventory[existingIndex],
        priceETB: item.priceETB,
        inStock: item.inStock !== undefined ? item.inStock : true,
        updatedAt: new Date().toISOString(),
      };
    } else {
      inventory.push({
        name: item.name,
        genericName: item.genericName || '',
        category: item.category || 'General',
        priceETB: item.priceETB,
        inStock: item.inStock !== undefined ? item.inStock : true,
        updatedAt: new Date().toISOString(),
      });
    }

    const inStockItems = [...pharmacy.inStockItems];
    if (!inStockItems.includes(cleanLower)) {
      inStockItems.push(cleanLower);
    }

    await pool.query(
      `UPDATE pharmacies SET inventory = $1, in_stock_items = $2, updated_at = NOW() WHERE id = $3`,
      [JSON.stringify(inventory), inStockItems, pharmacyId]
    );

    return true;
  }
}

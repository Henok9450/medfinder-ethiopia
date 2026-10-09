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

    // Anti-Ghosting Quota: Limit each patient to max 2 active holds
    const countRes = await pool.query(
      `SELECT COUNT(*) FROM reservations WHERE patient_user_id = $1 AND status = 'ACTIVE' AND expires_at > NOW()`,
      [holdData.patientUserId]
    );
    const activeCount = parseInt(countRes.rows[0]?.count || '0', 10);
    if (activeCount >= 2) {
      console.warn(`[AntiGhosting] Patient ${holdData.patientUserId} exceeded active reservation quota (${activeCount}/2)`);
      return null;
    }

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
      pharmacistAcknowledged: false,
      createdAt: now.toISOString(),
      expiresAt,
      latitude: pharmacy.latitude,
      longitude: pharmacy.longitude,
      subCity: pharmacy.subCity,
      address: pharmacy.address,
    };
  }

  public async getReservationHold(code: string): Promise<ReservationHold | null> {
    const pool = getDbPool();
    if (!pool) return null;

    const cleanCode = code.trim().replace(/^#/, '');
    const res = await pool.query(
      `SELECT 
        r.*,
        p.sub_city AS "subCity",
        p.address,
        ST_Y(p.location::geometry) AS latitude,
        ST_X(p.location::geometry) AS longitude
       FROM reservations r
       LEFT JOIN pharmacies p ON r.pharmacy_id = p.id
       WHERE UPPER(r.reservation_code) = UPPER($1) OR r.reservation_code = $1`,
      [cleanCode]
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
      pharmacistAcknowledged: Boolean(r.pharmacist_acknowledged),
      acknowledgedAt: r.acknowledged_at ? new Date(r.acknowledged_at).toISOString() : undefined,
      createdAt: new Date(r.created_at).toISOString(),
      expiresAt: new Date(r.expires_at).toISOString(),
      latitude: r.latitude != null ? parseFloat(r.latitude) : undefined,
      longitude: r.longitude != null ? parseFloat(r.longitude) : undefined,
      subCity: r.subCity || undefined,
      address: r.address || undefined,
    };
  }

  public async linkReservationPatientChatId(code: string, chatId: string): Promise<ReservationHold | null> {
    const pool = getDbPool();
    if (!pool) return null;

    const cleanCode = code.trim().replace(/^#/, '');
    await pool.query(
      `UPDATE reservations SET patient_user_id = $1 WHERE UPPER(reservation_code) = UPPER($2) OR reservation_code = $2`,
      [chatId, cleanCode]
    );
    return this.getReservationHold(cleanCode);
  }

  public async getActiveReservationsByPharmacy(pharmacyId: string): Promise<ReservationHold[]> {
    const pool = getDbPool();
    if (!pool) return [];

    const res = await pool.query(
      `SELECT * FROM reservations 
       WHERE pharmacy_id = $1 AND status = 'ACTIVE' AND expires_at > NOW() 
       ORDER BY created_at DESC`,
      [pharmacyId]
    );

    return res.rows.map((r) => ({
      reservationCode: r.reservation_code,
      patientUserId: r.patient_user_id,
      pharmacyId: r.pharmacy_id,
      pharmacyName: r.pharmacy_name,
      medicineName: r.medicine_name,
      lockedPriceETB: parseFloat(r.locked_price_etb),
      phone: r.phone,
      status: r.status,
      pharmacistAcknowledged: Boolean(r.pharmacist_acknowledged),
      acknowledgedAt: r.acknowledged_at ? new Date(r.acknowledged_at).toISOString() : undefined,
      createdAt: new Date(r.created_at).toISOString(),
      expiresAt: new Date(r.expires_at).toISOString(),
    }));
  }

  public async confirmReservationHold(
    code: string
  ): Promise<{ success: boolean; message: string; reservation?: ReservationHold }> {
    const pool = getDbPool();
    if (!pool) return { success: false, message: 'Database offline' };

    const hold = await this.getReservationHold(code);
    if (!hold) return { success: false, message: 'Reservation not found' };
    if (hold.status !== 'ACTIVE' || new Date() > new Date(hold.expiresAt)) {
      return { success: false, message: 'Reservation is no longer active or has expired' };
    }

    const cleanCode = code.trim().replace(/^#/, '');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 60 * 60 * 1000);
    await pool.query(
      `UPDATE reservations 
       SET pharmacist_acknowledged = TRUE, 
           acknowledged_at = $1, 
           expires_at = $2 
       WHERE UPPER(reservation_code) = UPPER($3) OR reservation_code = $3`,
      [now, expiresAt, cleanCode]
    );
    hold.pharmacistAcknowledged = true;
    hold.acknowledgedAt = now.toISOString();
    hold.expiresAt = expiresAt.toISOString();

    return {
      success: true,
      message: 'Shelf stock physically confirmed and held at counter.',
      reservation: hold,
    };
  }

  public async rejectReservationHold(
    code: string,
    reason?: string
  ): Promise<{ success: boolean; message: string; reservation?: ReservationHold }> {
    const pool = getDbPool();
    if (!pool) return { success: false, message: 'Database offline' };

    const hold = await this.getReservationHold(code);
    if (!hold) return { success: false, message: 'Reservation not found' };

    const cleanCode = code.trim().replace(/^#/, '');
    await pool.query(
      `UPDATE reservations SET status = 'CANCELLED' WHERE UPPER(reservation_code) = UPPER($1) OR reservation_code = $1`,
      [cleanCode]
    );
    hold.status = 'CANCELLED';

    return {
      success: true,
      message: reason || 'Reservation cancelled by pharmacist (Out of stock / Sold out).',
      reservation: hold,
    };
  }

  public async verifyAndFulfillReservation(
    code: string
  ): Promise<{ success: boolean; message: string; reservation?: ReservationHold }> {
    const pool = getDbPool();
    if (!pool) return { success: false, message: 'Database offline' };

    const cleanCode = code.trim().replace(/^#/, '');
    const hold = await this.getReservationHold(cleanCode);
    if (!hold) return { success: false, message: 'Reservation code not found' };

    if (new Date() > new Date(hold.expiresAt)) {
      await pool.query(
        `UPDATE reservations SET status = 'EXPIRED' WHERE UPPER(reservation_code) = UPPER($1) OR reservation_code = $1`,
        [cleanCode]
      );
      return { success: false, message: 'This reservation hold has expired (60-minute limit exceeded)' };
    }

    if (hold.status === 'CANCELLED') {
      return { success: false, message: 'This reservation hold was previously cancelled or marked out of stock.' };
    }

    await pool.query(
      `UPDATE reservations SET status = 'FULFILLED' WHERE UPPER(reservation_code) = UPPER($1) OR reservation_code = $1`,
      [cleanCode]
    );
    hold.status = 'FULFILLED';

    // Boost pharmacy trust score slightly on fulfillment
    await pool.query(
      `UPDATE pharmacies SET trust_score = LEAST(100, trust_score + 1) WHERE id = $1`,
      [hold.pharmacyId]
    );

    return {
      success: true,
      message: `Reservation #${cleanCode} verified successfully. Price locked at ${hold.lockedPriceETB} ETB.`,
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
    let portalUsername: string | undefined = appRow.portal_username || undefined;
    let portalTempPassword: string | undefined = appRow.portal_temp_password || undefined;
    let portalSetupToken: string | undefined = appRow.portal_setup_token || undefined;

    if (status === 'APPROVED') {
      const cleanSubCity = (appRow.sub_city || 'Bole').toLowerCase().replace(/[^a-z]/g, '') || 'bole';
      const pharmId = appRow.approved_pharmacy_id || `pharm-${cleanSubCity}-${Math.floor(1000 + Math.random() * 9000)}`;
      const lat = appRow.lat !== null && appRow.lat !== undefined ? parseFloat(appRow.lat) : 9.01;
      const lng = appRow.lng !== null && appRow.lng !== undefined ? parseFloat(appRow.lng) : 38.76;

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
        ON CONFLICT (id) DO UPDATE
        SET is_verified = TRUE, updated_at = NOW()
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

      // 1. Generate clean base username
      const cleanName = (appRow.pharmacy_name || 'pharm')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '');
      const randNum = Math.floor(100 + Math.random() * 900);
      const baseUsername = cleanName ? `${cleanName.substring(0, 15)}_${randNum}` : `pharm_${randNum}`;

      // 2. Check if account already exists for this pharmacy
      const existingAccRes = await pool.query(
        'SELECT * FROM pharmacy_portal_accounts WHERE pharmacy_id = $1',
        [pharmId]
      );

      if (existingAccRes.rows.length > 0) {
        const existingAcc = existingAccRes.rows[0];
        portalUsername = existingAcc.username;
        portalTempPassword = existingAcc.temp_password || `Med#${Math.floor(1000 + Math.random() * 9000)}!ET`;
        portalSetupToken = crypto.randomBytes(16).toString('hex');
        const setupExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
        await pool.query(
          `UPDATE pharmacy_portal_accounts 
           SET setup_token = $1, setup_token_expires_at = $2 
           WHERE id = $3`,
          [portalSetupToken, setupExpires, existingAcc.id]
        );
      } else {
        let candidateUsername = baseUsername;
        let counter = 1;
        while (true) {
          const checkUser = await pool.query(
            'SELECT id FROM pharmacy_portal_accounts WHERE LOWER(username) = LOWER($1)',
            [candidateUsername]
          );
          if (checkUser.rows.length === 0) break;
          candidateUsername = `${baseUsername}_${counter++}`;
        }
        portalUsername = candidateUsername;
        const tempCode = Math.floor(1000 + Math.random() * 9000);
        portalTempPassword = `Med#${tempCode}!ET`;
        const passwordHash = this.hashPassword(portalTempPassword);
        portalSetupToken = crypto.randomBytes(16).toString('hex');
        const setupExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
        const accountId = `acc-${crypto.randomBytes(4).toString('hex')}`;

        await pool.query(
          `INSERT INTO pharmacy_portal_accounts (
             id, pharmacy_id, pharmacy_name, sub_city, phone, username,
             password_hash, temp_password, setup_token, setup_token_expires_at,
             must_change_password, created_at
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, TRUE, NOW())`,
          [
            accountId,
            pharmId,
            appRow.pharmacy_name,
            appRow.sub_city,
            appRow.phone,
            portalUsername,
            passwordHash,
            portalTempPassword,
            portalSetupToken,
            setupExpires,
          ]
        );
      }

      await pool.query(
        `UPDATE pharmacy_verification_applications
         SET approved_pharmacy_id = $1, portal_username = $2, portal_temp_password = $3, portal_setup_token = $4
         WHERE id = $5`,
        [pharmId, portalUsername, portalTempPassword, portalSetupToken, id]
      );
    } else if (status === 'REJECTED') {
      if (appRow.approved_pharmacy_id) {
        await pool.query('UPDATE pharmacies SET is_verified = FALSE WHERE id = $1', [appRow.approved_pharmacy_id]);
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
        addressDetails: appRow.address_details,
        phone: appRow.phone,
        pharmacistName: appRow.pharmacist_name,
        pharmacistLicenseNumber: appRow.pharmacist_license_number,
        efdaLicenseNumber: finalEfda,
        tinNumber: appRow.tin_number,
        counterPhotoUrl: appRow.counter_photo_url,
        efdaDocUrl: appRow.efda_doc_url,
        status,
        adminNotes: adminNotes || appRow.admin_notes,
        submittedAt: new Date(appRow.submitted_at).toISOString(),
        reviewedAt: new Date().toISOString(),
        approvedPharmacyId: createdPharm?.id || appRow.approved_pharmacy_id,
        portalUsername,
        portalTempPassword,
        portalSetupToken,
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
        tempPassword: acc.temp_password || undefined,
        setupToken: acc.setup_token || undefined,
        setupTokenExpiresAt: acc.setup_token_expires_at ? new Date(acc.setup_token_expires_at).toISOString() : undefined,
        mustChangePassword: Boolean(acc.must_change_password),
        createdAt: new Date(acc.created_at).toISOString(),
        lastLoginAt: new Date().toISOString(),
        sessionToken: token,
      },
    };
  }

  public async getAccountBySetupToken(setupToken: string): Promise<PharmacyPortalAccount | null> {
    const pool = getDbPool();
    if (!pool || !setupToken) return null;

    const res = await pool.query(
      `SELECT * FROM pharmacy_portal_accounts WHERE setup_token = $1`,
      [setupToken.trim()]
    );
    if (res.rows.length === 0) return null;
    const acc = res.rows[0];

    return {
      id: acc.id,
      pharmacyId: acc.pharmacy_id,
      pharmacyName: acc.pharmacy_name,
      subCity: acc.sub_city,
      phone: acc.phone,
      username: acc.username,
      passwordHash: acc.password_hash,
      tempPassword: acc.temp_password || undefined,
      setupToken: acc.setup_token || undefined,
      setupTokenExpiresAt: acc.setup_token_expires_at ? new Date(acc.setup_token_expires_at).toISOString() : undefined,
      mustChangePassword: Boolean(acc.must_change_password),
      createdAt: new Date(acc.created_at).toISOString(),
      lastLoginAt: acc.last_login_at ? new Date(acc.last_login_at).toISOString() : undefined,
      sessionToken: acc.session_token || undefined,
    };
  }

  public async activateAccountWithToken(
    setupToken: string,
    newPassword: string,
    customUsername?: string
  ): Promise<{ success: boolean; account?: PharmacyPortalAccount; token?: string; error?: string }> {
    const pool = getDbPool();
    if (!pool || !setupToken) return { success: false, error: 'Database offline or invalid token' };

    const res = await pool.query(
      `SELECT * FROM pharmacy_portal_accounts WHERE setup_token = $1`,
      [setupToken.trim()]
    );
    if (res.rows.length === 0) return { success: false, error: 'Invalid or expired setup token' };
    const targetAcc = res.rows[0];

    if (targetAcc.setup_token_expires_at && new Date(targetAcc.setup_token_expires_at).getTime() < Date.now()) {
      return { success: false, error: 'Setup link has expired. Please contact EFDA support or request a new link.' };
    }

    if (!newPassword || newPassword.length < 8) {
      return { success: false, error: 'Password must be at least 8 characters long' };
    }

    let finalUsername = targetAcc.username;
    if (customUsername && customUsername.trim().length >= 3) {
      const cleanCustom = customUsername.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
      if (cleanCustom !== targetAcc.username) {
        const checkConflict = await pool.query(
          `SELECT id FROM pharmacy_portal_accounts WHERE LOWER(username) = LOWER($1) AND id != $2`,
          [cleanCustom, targetAcc.id]
        );
        if (checkConflict.rows.length > 0) {
          return { success: false, error: 'Chosen username is already taken. Please choose another.' };
        }
        finalUsername = cleanCustom;
      }
    }

    const newHash = this.hashPassword(newPassword);
    const sessionToken = 'sess_' + crypto.randomBytes(16).toString('hex');

    await pool.query(
      `UPDATE pharmacy_portal_accounts 
       SET username = $1, password_hash = $2, must_change_password = FALSE,
           temp_password = NULL, setup_token = NULL, setup_token_expires_at = NULL,
           session_token = $3, last_login_at = NOW()
       WHERE id = $4`,
      [finalUsername, newHash, sessionToken, targetAcc.id]
    );

    const updatedAccount: PharmacyPortalAccount = {
      id: targetAcc.id,
      pharmacyId: targetAcc.pharmacy_id,
      pharmacyName: targetAcc.pharmacy_name,
      subCity: targetAcc.sub_city,
      phone: targetAcc.phone,
      username: finalUsername,
      passwordHash: newHash,
      mustChangePassword: false,
      createdAt: new Date(targetAcc.created_at).toISOString(),
      sessionToken,
      lastLoginAt: new Date().toISOString(),
    };

    return { success: true, account: updatedAccount, token: sessionToken };
  }

  public async changePharmacyPassword(
    username: string,
    currentPassword: string,
    newPassword: string
  ): Promise<{ success: boolean; account?: PharmacyPortalAccount; error?: string }> {
    const pool = getDbPool();
    if (!pool) return { success: false, error: 'Database offline' };

    const res = await pool.query(
      `SELECT * FROM pharmacy_portal_accounts WHERE LOWER(username) = LOWER($1)`,
      [username.trim()]
    );
    if (res.rows.length === 0) return { success: false, error: 'Account not found' };
    const acc = res.rows[0];

    const currentHash = this.hashPassword(currentPassword);
    if (acc.password_hash !== currentHash) {
      return { success: false, error: 'Current password incorrect' };
    }

    if (!newPassword || newPassword.length < 8) {
      return { success: false, error: 'New password must be at least 8 characters long' };
    }

    const newHash = this.hashPassword(newPassword);
    await pool.query(
      `UPDATE pharmacy_portal_accounts 
       SET password_hash = $1, must_change_password = FALSE,
           temp_password = NULL, setup_token = NULL, setup_token_expires_at = NULL
       WHERE id = $2`,
      [newHash, acc.id]
    );

    return {
      success: true,
      account: {
        id: acc.id,
        pharmacyId: acc.pharmacy_id,
        pharmacyName: acc.pharmacy_name,
        subCity: acc.sub_city,
        phone: acc.phone,
        username: acc.username,
        passwordHash: newHash,
        mustChangePassword: false,
        createdAt: new Date(acc.created_at).toISOString(),
      },
    };
  }

  public async getAccountBySession(token: string): Promise<PharmacyPortalAccount | null> {
    const pool = getDbPool();
    if (!pool || !token) return null;

    const res = await pool.query(
      `SELECT * FROM pharmacy_portal_accounts WHERE session_token = $1`,
      [token.trim()]
    );
    if (res.rows.length === 0) return null;
    const acc = res.rows[0];

    return {
      id: acc.id,
      pharmacyId: acc.pharmacy_id,
      pharmacyName: acc.pharmacy_name,
      subCity: acc.sub_city,
      phone: acc.phone,
      username: acc.username,
      passwordHash: acc.password_hash,
      tempPassword: acc.temp_password || undefined,
      setupToken: acc.setup_token || undefined,
      setupTokenExpiresAt: acc.setup_token_expires_at ? new Date(acc.setup_token_expires_at).toISOString() : undefined,
      mustChangePassword: Boolean(acc.must_change_password),
      createdAt: new Date(acc.created_at).toISOString(),
      lastLoginAt: acc.last_login_at ? new Date(acc.last_login_at).toISOString() : undefined,
      sessionToken: acc.session_token || undefined,
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

  public async getAdminBySession(token: string): Promise<AdminUser | null> {
    const pool = getDbPool();
    if (!pool || !token) return null;

    const res = await pool.query(
      `SELECT * FROM admin_users WHERE session_token = $1`,
      [token.trim()]
    );
    if (res.rows.length === 0) return null;
    const user = res.rows[0];

    return {
      id: user.id,
      username: user.username,
      fullName: user.full_name,
      email: user.email,
      role: user.role,
      privileges: typeof user.privileges === 'string' ? JSON.parse(user.privileges) : user.privileges,
      passwordHash: user.password_hash,
      createdAt: new Date(user.created_at).toISOString(),
      lastLoginAt: user.last_login_at ? new Date(user.last_login_at).toISOString() : undefined,
      sessionToken: user.session_token,
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

  public async toggleMedicineStock(pharmacyId: string, medicineName: string, inStock: boolean): Promise<boolean> {
    const pool = getDbPool();
    if (!pool) return false;

    const pharmacy = await this.getPharmacyById(pharmacyId);
    if (!pharmacy) return false;

    const inventory = [...pharmacy.inventory];
    const item = inventory.find((i) => i.name.toLowerCase() === medicineName.toLowerCase());
    if (!item) return false;

    item.inStock = inStock;
    item.updatedAt = new Date().toISOString();

    let inStockItems = [...pharmacy.inStockItems];
    const lower = medicineName.toLowerCase();
    if (!inStock) {
      inStockItems = inStockItems.filter((i) => !i.includes(lower));
    } else if (!inStockItems.includes(lower)) {
      inStockItems.push(lower);
    }

    await pool.query(
      `UPDATE pharmacies SET inventory = $1, in_stock_items = $2, updated_at = NOW() WHERE id = $3`,
      [JSON.stringify(inventory), inStockItems, pharmacyId]
    );

    return true;
  }

  public async removeMedicine(pharmacyId: string, medicineName: string): Promise<boolean> {
    const pool = getDbPool();
    if (!pool) return false;

    const pharmacy = await this.getPharmacyById(pharmacyId);
    if (!pharmacy) return false;

    const inventory = pharmacy.inventory.filter((i) => i.name.toLowerCase() !== medicineName.toLowerCase());
    const inStockItems = pharmacy.inStockItems.filter((i) => !i.includes(medicineName.toLowerCase()));

    await pool.query(
      `UPDATE pharmacies SET inventory = $1, in_stock_items = $2, updated_at = NOW() WHERE id = $3`,
      [JSON.stringify(inventory), inStockItems, pharmacyId]
    );

    return true;
  }

  public async bulkImportChecklist(
    pharmacyId: string,
    items: Array<{ name: string; priceETB: number; category?: string; genericName?: string }>
  ): Promise<number> {
    let count = 0;
    for (const item of items) {
      if (await this.addOrUpdateMedicine(pharmacyId, item)) {
        count++;
      }
    }
    return count;
  }

  public async parseAndImportCsv(pharmacyId: string, csvContent: string): Promise<{ imported: number; errors: number }> {
    const lines = csvContent.split('\n');
    let imported = 0;
    let errors = 0;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.toLowerCase().startsWith('medicine') || trimmed.toLowerCase().startsWith('name')) {
        continue;
      }

      const parts = trimmed.split(',').map((p) => p.trim());
      if (parts.length >= 2) {
        const name = parts[0];
        const priceETB = parseFloat(parts[1]);
        const category = parts[2] || 'Imported';

        if (name && !isNaN(priceETB)) {
          const ok = await this.addOrUpdateMedicine(pharmacyId, { name, priceETB, category });
          if (ok) imported++;
          else errors++;
        } else {
          errors++;
        }
      }
    }

    return { imported, errors };
  }

  public async reportViolation(params: {
    patientUserId: string;
    pharmacyId: string;
    medicineName: string;
    issueType: 'PRICE_GOUGING' | 'OUT_OF_STOCK_PHANTOM' | 'EXPIRED_MEDICINE' | 'UNPROFESSIONAL';
    description?: string;
  }): Promise<{ success: boolean; strikeCount: number; newTrustScore: number; penaltyApplied: string }> {
    const pool = getDbPool();
    if (!pool) return { success: false, strikeCount: 0, newTrustScore: 0, penaltyApplied: 'Database offline' };

    const pharmacy = await this.getPharmacyById(params.pharmacyId);
    if (!pharmacy) return { success: false, strikeCount: 0, newTrustScore: 0, penaltyApplied: 'Pharmacy not found' };

    const newStrike = pharmacy.strikeCount + 1;
    const newTrust = Math.max(10, pharmacy.trustScore - 15);
    let penalty = 'Formal Warning Logged';
    let isShadowBanned = pharmacy.isShadowBanned;
    let shadowBanUntil: string | null = pharmacy.shadowBanUntil || null;
    let isVerified = pharmacy.isVerified;
    let isPermanentlyBanned = pharmacy.isPermanentlyBanned;

    if (newStrike === 1) {
      isShadowBanned = true;
      shadowBanUntil = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
      penalty = 'Strike 1: 48-Hour Broadcast Shadowban applied + Trust Score dropped by 15%.';
    } else if (newStrike === 2) {
      isVerified = false;
      isShadowBanned = true;
      penalty = 'Strike 2: "Verified" EFDA Badge revoked and pharmacy deprioritized.';
    } else if (newStrike >= 3) {
      isPermanentlyBanned = true;
      isVerified = false;
      penalty = 'Strike 3: Permanent Blacklist! License and TIN permanently banned from MedFinder.';
    }

    await pool.query(
      `UPDATE pharmacies SET 
        strike_count = $1, trust_score = $2, is_shadow_banned = $3, 
        shadow_ban_until = $4, is_verified = $5, is_permanently_banned = $6,
        updated_at = NOW()
       WHERE id = $7`,
      [newStrike, newTrust, isShadowBanned, shadowBanUntil ? new Date(shadowBanUntil) : null, isVerified, isPermanentlyBanned, params.pharmacyId]
    );

    const reportId = `REP-${Date.now()}`;
    await pool.query(
      `INSERT INTO violation_reports (
        id, patient_user_id, pharmacy_id, pharmacy_name, medicine_name,
        issue_type, description, reported_at, strike_applied, new_trust_score
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), TRUE, $8)`,
      [reportId, params.patientUserId, pharmacy.id, pharmacy.name, params.medicineName, params.issueType, params.description || null, newTrust]
    );

    return {
      success: true,
      strikeCount: newStrike,
      newTrustScore: newTrust,
      penaltyApplied: penalty,
    };
  }

  public async getVerificationApplications(): Promise<PharmacyVerificationApplication[]> {
    const pool = getDbPool();
    if (!pool) return [];

    const res = await pool.query(
      `SELECT *, ST_Y(location::geometry) as lat, ST_X(location::geometry) as lng 
       FROM pharmacy_verification_applications ORDER BY submitted_at DESC`
    );

    return res.rows.map((r) => ({
      id: r.id,
      telegramChatId: r.telegram_chat_id,
      telegramUsername: r.telegram_username,
      pharmacyName: r.pharmacy_name,
      subCity: r.sub_city,
      addressDetails: r.address_details,
      latitude: r.lat !== null ? parseFloat(r.lat) : undefined,
      longitude: r.lng !== null ? parseFloat(r.lng) : undefined,
      gpsLocationVerified: Boolean(r.gps_location_verified),
      phone: r.phone,
      pharmacistName: r.pharmacist_name,
      pharmacistLicenseNumber: r.pharmacist_license_number,
      efdaLicenseNumber: r.efda_license_number,
      tinNumber: r.tin_number,
      counterPhotoUrl: r.counter_photo_url,
      efdaDocUrl: r.efda_doc_url,
      status: r.status,
      adminNotes: r.admin_notes,
      requestedInfoReason: r.requested_info_reason,
      submittedAt: new Date(r.submitted_at).toISOString(),
      reviewedAt: r.reviewed_at ? new Date(r.reviewed_at).toISOString() : undefined,
      approvedPharmacyId: r.approved_pharmacy_id,
      portalUsername: r.portal_username,
      portalTempPassword: r.portal_temp_password,
      portalSetupToken: r.portal_setup_token,
    }));
  }

  public async resubmitVerificationApplication(
    id: string,
    updates: {
      photoUrl?: string;
      efdaLicenseNumber?: string;
      tinNumber?: string;
      location?: { latitude: number; longitude: number; subCity?: string; addressDetails?: string };
      note?: string;
    }
  ): Promise<PharmacyVerificationApplication | null> {
    const pool = getDbPool();
    if (!pool) return null;

    let locSql = '';
    const params: any[] = [id];

    if (updates.location) {
      params.push(updates.location.longitude, updates.location.latitude);
      locSql = `, location = ST_SetSRID(ST_MakePoint($${params.length - 1}, $${params.length}), 4326), gps_location_verified = TRUE`;
      if (updates.location.subCity) {
        params.push(updates.location.subCity);
        locSql += `, sub_city = $${params.length}`;
      }
      if (updates.location.addressDetails) {
        params.push(updates.location.addressDetails);
        locSql += `, address_details = $${params.length}`;
      }
    }

    if (updates.photoUrl) {
      params.push(updates.photoUrl);
      locSql += `, counter_photo_url = $${params.length}, efda_doc_url = $${params.length}`;
    }
    if (updates.efdaLicenseNumber) {
      params.push(updates.efdaLicenseNumber);
      locSql += `, efda_license_number = $${params.length}`;
    }
    if (updates.tinNumber) {
      params.push(updates.tinNumber);
      locSql += `, tin_number = $${params.length}`;
    }

    const note = updates.note || 'Applicant uploaded updated verification materials';
    params.push(note);
    const noteParamIdx = params.length;

    const query = `
      UPDATE pharmacy_verification_applications
      SET status = 'RESUBMITTED', resubmitted_at = NOW(), pharmacist_update_note = $${noteParamIdx}
          ${locSql}
      WHERE id = $1
      RETURNING *, ST_Y(location::geometry) as lat, ST_X(location::geometry) as lng;
    `;

    const res = await pool.query(query, params);
    if (res.rows.length === 0) return null;
    const r = res.rows[0];

    return {
      id: r.id,
      telegramChatId: r.telegram_chat_id,
      telegramUsername: r.telegram_username,
      pharmacyName: r.pharmacy_name,
      subCity: r.sub_city,
      addressDetails: r.address_details,
      latitude: r.lat !== null ? parseFloat(r.lat) : undefined,
      longitude: r.lng !== null ? parseFloat(r.lng) : undefined,
      gpsLocationVerified: Boolean(r.gps_location_verified),
      phone: r.phone,
      pharmacistName: r.pharmacist_name,
      pharmacistLicenseNumber: r.pharmacist_license_number,
      efdaLicenseNumber: r.efda_license_number,
      tinNumber: r.tin_number,
      counterPhotoUrl: r.counter_photo_url,
      efdaDocUrl: r.efda_doc_url,
      status: r.status,
      submittedAt: new Date(r.submitted_at).toISOString(),
    };
  }
}


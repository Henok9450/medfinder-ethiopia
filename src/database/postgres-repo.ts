import { getDbPool } from './db-client';
import { Pharmacy, ReservationHold, BroadcastRequest } from './in-memory-db';

export class PostgresRepository {
  private static instance: PostgresRepository;

  public static getInstance(): PostgresRepository {
    if (!PostgresRepository.instance) {
      PostgresRepository.instance = new PostgresRepository();
    }
    return PostgresRepository.instance;
  }

  /**
   * PostGIS Geo-query: Find pharmacies within radius (in km) with medicine search
   */
  public async findNearbyPharmacies(params: {
    lat: number;
    lng: number;
    radiusKm: number;
    medicineName?: string;
  }): Promise<Array<Pharmacy & { distanceKm: number }>> {
    const pool = getDbPool();
    if (!pool) return [];

    const radiusMeters = params.radiusKm * 1000;
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
        ROUND((ST_DistanceSphere(location, ST_MakePoint($1, $2)) / 1000.0)::numeric, 2) AS "distanceKm"
      FROM pharmacies
      WHERE 
        is_verified = TRUE
        AND is_permanently_banned = FALSE
        AND is_shadow_banned = FALSE
        AND ST_DWithin(location, ST_MakePoint($1, $2)::geography, $3)
    `;

    const values: any[] = [params.lng, params.lat, radiusMeters];

    if (params.medicineName) {
      values.push(`%${params.medicineName.toLowerCase()}%`);
      query += ` AND EXISTS (
        SELECT 1 FROM unnest(in_stock_items) item 
        WHERE LOWER(item) LIKE $${values.length}
      )`;
    }

    query += ` ORDER BY "distanceKm" ASC LIMIT 20;`;

    const res = await pool.query(query, values);
    return res.rows.map((r) => ({
      ...r,
      distanceKm: parseFloat(r.distanceKm),
      latitude: parseFloat(r.latitude),
      longitude: parseFloat(r.longitude),
      trustScore: parseInt(r.trustScore, 10),
      strikeCount: parseInt(r.strikeCount, 10),
    }));
  }

  /**
   * PostGIS Insert/Update Pharmacy with ST_MakePoint(longitude, latitude)
   */
  public async upsertPharmacy(p: Pharmacy): Promise<void> {
    const pool = getDbPool();
    if (!pool) return;

    const query = `
      INSERT INTO pharmacies (
        id, name, sub_city, city, phone, address, telegram_chat_id,
        is_verified, efda_license_number, tin_number, tier, trust_score,
        strike_count, is_shadow_banned, shadow_ban_until, is_permanently_banned,
        in_stock_items, inventory, location, updated_at
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, $11, $12,
        $13, $14, $15, $16,
        $17, $18, ST_SetSRID(ST_MakePoint($19, $20), 4326), NOW()
      )
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        sub_city = EXCLUDED.sub_city,
        city = EXCLUDED.city,
        phone = EXCLUDED.phone,
        address = EXCLUDED.address,
        telegram_chat_id = EXCLUDED.telegram_chat_id,
        is_verified = EXCLUDED.is_verified,
        efda_license_number = EXCLUDED.efda_license_number,
        tin_number = EXCLUDED.tin_number,
        tier = EXCLUDED.tier,
        trust_score = EXCLUDED.trust_score,
        strike_count = EXCLUDED.strike_count,
        is_shadow_banned = EXCLUDED.is_shadow_banned,
        shadow_ban_until = EXCLUDED.shadow_ban_until,
        is_permanently_banned = EXCLUDED.is_permanently_banned,
        in_stock_items = EXCLUDED.in_stock_items,
        inventory = EXCLUDED.inventory,
        location = EXCLUDED.location,
        updated_at = NOW();
    `;

    await pool.query(query, [
      p.id,
      p.name,
      p.subCity,
      p.city,
      p.phone,
      p.address || null,
      p.telegramChatId || null,
      p.isVerified,
      p.efdaLicenseNumber,
      p.tinNumber,
      p.tier,
      p.trustScore,
      p.strikeCount,
      p.isShadowBanned,
      p.shadowBanUntil ? new Date(p.shadowBanUntil) : null,
      p.isPermanentlyBanned,
      p.inStockItems,
      JSON.stringify(p.inventory),
      p.longitude,
      p.latitude,
    ]);
  }

  /**
   * Create Anti-Scam 1-hour Price Lock Reservation in PostgreSQL
   */
  public async createReservation(hold: ReservationHold): Promise<void> {
    const pool = getDbPool();
    if (!pool) return;

    const query = `
      INSERT INTO reservations (
        reservation_code, patient_user_id, pharmacy_id, pharmacy_name,
        medicine_name, locked_price_etb, phone, status, created_at, expires_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `;

    await pool.query(query, [
      hold.reservationCode,
      hold.patientUserId,
      hold.pharmacyId,
      hold.pharmacyName,
      hold.medicineName,
      hold.lockedPriceETB,
      hold.phone,
      hold.status,
      new Date(hold.createdAt),
      new Date(hold.expiresAt),
    ]);
  }

  /**
   * Save Broadcast Request with spatial point
   */
  public async saveBroadcastRequest(req: BroadcastRequest): Promise<void> {
    const pool = getDbPool();
    if (!pool) return;

    const query = `
      INSERT INTO broadcast_requests (
        id, user_id, medicine_name, user_location, current_radius_km,
        pinged_pharmacy_ids, status, responses, created_at
      )
      VALUES (
        $1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326), $6,
        $7, $8, $9, $10
      )
      ON CONFLICT (id) DO UPDATE SET
        status = EXCLUDED.status,
        responses = EXCLUDED.responses,
        pinged_pharmacy_ids = EXCLUDED.pinged_pharmacy_ids;
    `;

    await pool.query(query, [
      req.id,
      req.userId,
      req.medicineName,
      req.userLng,
      req.userLat,
      req.currentRadiusKm,
      req.pingedPharmacyIds,
      req.status,
      JSON.stringify(req.responses),
      new Date(req.createdAt),
    ]);
  }
}

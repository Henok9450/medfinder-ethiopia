import crypto from 'crypto';
import { UserSubscription, PaymentInvoice } from '../monetization/subscription.types';

export type AdminRole = 'SUPER_ADMIN' | 'EFDA_OFFICER' | 'SUPPORT_AUDITOR';

export interface AdminPrivileges {
  canReviewApplications: boolean; // Review EFDA CoC, approve, reject, request info
  canManagePolicies: boolean;     // Adjust pricing, monetization, geo radius
  canManageAdmins: boolean;       // Create/delete admin accounts and adjust privileges
  canViewAuditLogs: boolean;      // Financial invoices, fraud reports
}

export interface AdminUser {
  id: string;
  username: string;
  fullName: string;
  email: string;
  role: AdminRole;
  privileges: AdminPrivileges;
  passwordHash: string;
  createdAt: string;
  lastLoginAt?: string;
  sessionToken?: string;
}

export interface PharmacyPortalAccount {
  id: string;
  pharmacyId: string;
  pharmacyName: string;
  subCity: string;
  phone: string;
  accessKey: string;           // 1-Click cryptographic magic access key (e.g. mf_key_...)
  telegramChatId?: string;     // Bound verified Telegram chat ID
  sessionToken?: string;       // 180-day persistent session token
  sessionExpiresAt?: string;   // 180-day expiry ISO timestamp
  lastOtpCode?: string;        // 4-digit temporary OTP for quick phone sign-in
  lastOtpExpiresAt?: string;   // OTP expiry ISO timestamp
  createdAt: string;
  lastLoginAt?: string;
  // Deprecated/optional legacy fields
  username?: string;
  passwordHash?: string;
  tempPassword?: string;
  setupToken?: string;
  setupTokenExpiresAt?: string;
  mustChangePassword?: boolean;
}

export interface PharmacyMedicineItem {
  name: string;
  genericName?: string;
  category: string;
  priceETB: number;
  inStock: boolean;
  updatedAt: string;
}

export interface Pharmacy {
  id: string;
  name: string;
  subCity: string;
  city: string;
  latitude: number;
  longitude: number;
  phone: string;
  address?: string;
  telegramChatId?: string;
  isVerified: boolean;
  efdaLicenseNumber: string; // EFDA license e.g. "EFDA/PH/AA/2025/1102"
  tinNumber: string; // Ethiopian TIN
  tier: 'BASIC' | 'PREMIUM';
  trustScore: number; // 0 to 100
  strikeCount: number; // 0 to 3
  isShadowBanned: boolean; // if true, hidden from broadcasts due to strike
  shadowBanUntil?: string;
  isPermanentlyBanned: boolean; // banned from platform
  inStockItems: string[]; // For backwards-compatible quick text search
  inventory: PharmacyMedicineItem[]; // Full structured inventory
  analyticsAccess?: {
    enabled: boolean;
    allowedSubCities?: string[]; // Empty or undefined = all sub-cities
    tier?: 'BASIC' | 'PRO' | 'ENTERPRISE';
    expiresAt?: string;
  };
}

export interface SearchAnalyticsEvent {
  id: string;
  query: string;
  normalizedDrug: string;
  coreBrandOrGeneric: string;
  subCity: string;
  city: string;
  matchedCount: number;
  userId?: string;
  timestamp: string;
}

export interface DemandIntelligenceItem {
  drugName: string;
  subCity: string;
  searchCount: number;
  stockingPharmaciesCount: number;
  unmetDemandRatio: number; // Search count / (Stocking + 1)
  shortageLevel: 'CRITICAL' | 'HIGH' | 'MODERATE' | 'SUFFICIENT';
  estimatedMissedSalesETB: number;
  lastSearchedAt: string;
}

export interface Wholesaler {
  id: string;
  name: string;
  subCity: string;
  city: string;
  phone: string;
  telegramChatId?: string;
  efdaWholesaleLicense: string; // EFDA license e.g. "EFDA/WHOLESALE/AA-9912"
  tinNumber: string;
  isVerified: boolean;
  trustScore: number;
  deliveryTerms: string;
  minimumOrderValueETB?: number;
}

export interface WholesaleListing {
  id: string;
  wholesalerId: string;
  wholesalerName: string;
  wholesalerPhone: string;
  wholesalerSubCity: string;
  drugName: string;
  genericName?: string;
  category: string;
  wholesalePriceETB: number;
  retailMspETB?: number;
  minimumOrderQty: number;
  availableStock: number;
  batchNumber: string;
  expiryDate: string;
  efdaRegistrationNo: string;
  originCountry: string;
  deliveryEstimateHours: number;
  isActive: boolean;
  updatedAt: string;
}

export interface WholesalePurchaseOrder {
  id: string;
  poNumber: string;
  pharmacyId: string;
  pharmacyName: string;
  pharmacySubCity: string;
  pharmacyPhone: string;
  wholesalerId: string;
  wholesalerName: string;
  listingId: string;
  drugName: string;
  quantity: number;
  unitPriceETB: number;
  totalPriceETB: number;
  platformFeeRate: number; // 0.02 (2%)
  platformFeeETB: number; // totalPriceETB * 0.02
  deliveryAddress: string;
  paymentMethod: 'COD' | 'TELEBIRR' | 'CBE_BIRR';
  status: 'PENDING' | 'CONFIRMED' | 'DISPATCHED' | 'DELIVERED' | 'CANCELLED';
  statusNotes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReservationHold {
  reservationCode: string; // 4-digit code e.g. "8492"
  patientUserId: string;
  pharmacyId: string;
  pharmacyName: string;
  medicineName: string;
  lockedPriceETB: number;
  phone: string;
  status: 'ACTIVE' | 'FULFILLED' | 'CANCELLED' | 'DISPUTED' | 'EXPIRED';
  pharmacistAcknowledged?: boolean;
  acknowledgedAt?: string;
  createdAt: string;
  expiresAt: string;
  latitude?: number;
  longitude?: number;
  subCity?: string;
  address?: string;
}

export interface PharmacyVerificationApplication {
  id: string; // e.g. "MF-VERIFY-8821"
  telegramChatId: string;
  telegramUsername?: string;
  pharmacyName: string;
  subCity: string;
  addressDetails?: string;
  latitude?: number;
  longitude?: number;
  gpsLocationVerified?: boolean;
  phone: string;
  pharmacistName: string;
  pharmacistLicenseNumber: string;
  efdaLicenseNumber: string; // EFDA/PH/AA/...
  tinNumber: string; // TIN-00...
  counterPhotoUrl?: string;
  efdaDocUrl?: string;
  status: 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | 'INFO_REQUESTED' | 'RESUBMITTED';
  adminNotes?: string;
  requestedInfoReason?: string;
  resubmittedAt?: string;
  pharmacistUpdateNote?: string;
  submittedAt: string;
  reviewedAt?: string;
  approvedPharmacyId?: string;
  portalAccessKey?: string;
  portalUsername?: string;
  portalTempPassword?: string;
  portalSetupToken?: string;
}

export interface TelegramBotSession {
  chatId: string;
  username?: string;
  step: 'START' | 'LANGUAGE' | 'PHARMACY_NAME' | 'LOCATION_GPS' | 'PHONE' | 'PHARMACIST_INFO' | 'EFDA_LICENSE' | 'TIN_NUMBER' | 'COUNTER_PHOTO' | 'CONFIRM' | 'AWAITING_INFO_UPDATE' | 'PATIENT_SEARCH' | 'AWAITING_SEARCH_LOCATION';
  mode?: 'PATIENT' | 'PHARMACY';
  patientSearchDrug?: string;
  patientLat?: number;
  patientLng?: number;
  patientSubCity?: string;
  updatingApplicationId?: string;
  data: Partial<PharmacyVerificationApplication>;
  language: 'am' | 'en';
}

export interface PharmacyViolationReport {
  id: string;
  patientUserId: string;
  pharmacyId: string;
  pharmacyName: string;
  medicineName: string;
  issueType: 'PRICE_GOUGING' | 'OUT_OF_STOCK_PHANTOM' | 'EXPIRED_MEDICINE' | 'UNPROFESSIONAL';
  description?: string;
  reportedAt: string;
  strikeApplied: boolean;
  newTrustScore: number;
}

export interface BroadcastRequest {
  id: string;
  userId: string;
  medicineName: string;
  userLat: number;
  userLng: number;
  currentRadiusKm: number;
  pingedPharmacyIds: string[];
  status: 'PENDING' | 'FULFILLED' | 'EXPIRED';
  createdAt: string;
  responses: Array<{
    pharmacyId: string;
    pharmacyName: string;
    priceETB: number;
    phone: string;
    distanceKm: number;
    respondedAt: string;
  }>;
}

// Master Pre-built Essential Medicines List for Ethiopia
export const MASTER_MEDICINE_CATALOG: Array<{ name: string; genericName: string; category: string; defaultPriceETB: number }> = [
  { name: 'Insulin (Humulin N / Regular)', genericName: 'Human Insulin', category: 'Diabetes', defaultPriceETB: 450 },
  { name: 'Metformin 500mg / 850mg', genericName: 'Metformin Hydrochloride', category: 'Diabetes', defaultPriceETB: 120 },
  { name: 'Augmentin 625mg / 1g', genericName: 'Amoxicillin + Clavulanic Acid', category: 'Antibiotics', defaultPriceETB: 380 },
  { name: 'Amoxicillin 500mg', genericName: 'Amoxicillin', category: 'Antibiotics', defaultPriceETB: 85 },
  { name: 'Azithromycin 500mg', genericName: 'Azithromycin', category: 'Antibiotics', defaultPriceETB: 220 },
  { name: 'Ventolin Inhaler 100mcg', genericName: 'Salbutamol', category: 'Respiratory', defaultPriceETB: 320 },
  { name: 'Eltroxin 50mcg / 100mcg', genericName: 'Levothyroxine Sodium', category: 'Thyroid', defaultPriceETB: 280 },
  { name: 'Amlodipine 5mg / 10mg', genericName: 'Amlodipine Besylate', category: 'Hypertension', defaultPriceETB: 110 },
  { name: 'Losartan Potassium 50mg', genericName: 'Losartan', category: 'Hypertension', defaultPriceETB: 140 },
  { name: 'Atorvastatin 20mg (Lipitor)', genericName: 'Atorvastatin', category: 'Cardiovascular', defaultPriceETB: 250 },
  { name: 'Omeprazole 20mg', genericName: 'Omeprazole', category: 'Gastrointestinal', defaultPriceETB: 70 },
  { name: 'Ceftriaxone 1g Vial', genericName: 'Ceftriaxone Sodium', category: 'Injectables', defaultPriceETB: 180 },
  { name: 'Paracetamol 500mg', genericName: 'Acetaminophen', category: 'Pain & Fever', defaultPriceETB: 30 },
  { name: 'Ibuprofen 400mg', genericName: 'Ibuprofen', category: 'Pain & Fever', defaultPriceETB: 45 },
];

export class InMemoryDatabase {
  private static instance: InMemoryDatabase;

  public subscriptions: Map<string, UserSubscription> = new Map();
  public invoices: Map<string, PaymentInvoice> = new Map();
  public pharmacies: Pharmacy[] = [];
  public broadcastRequests: Map<string, BroadcastRequest> = new Map();
  public reservations: Map<string, ReservationHold> = new Map(); // Keyed by reservationCode
  public violationReports: PharmacyViolationReport[] = [];
  public verificationApplications: PharmacyVerificationApplication[] = [];
  public botSessions: Map<string, TelegramBotSession> = new Map(); // Keyed by telegramChatId
  public pharmacyAccounts: Map<string, PharmacyPortalAccount> = new Map(); // Keyed by username
  public adminUsers: Map<string, AdminUser> = new Map(); // Keyed by username
  public searchAnalyticsEvents: SearchAnalyticsEvent[] = [];
  public wholesalers: Wholesaler[] = [];
  public wholesaleListings: WholesaleListing[] = [];
  public wholesalePurchaseOrders: WholesalePurchaseOrder[] = [];

  private constructor() {
    this.seedPharmacies();
    this.seedVerificationApplications();
    this.seedDefaultAdmin();
    this.seedSearchTelemetry();
    this.seedWholesaleMarketplace();
  }

  public static getInstance(): InMemoryDatabase {
    if (!InMemoryDatabase.instance) {
      InMemoryDatabase.instance = new InMemoryDatabase();
    }
    return InMemoryDatabase.instance;
  }

  private seedPharmacies() {
    const defaultPharm: Pharmacy = {
      id: 'pharm-bole-3527',
      name: 'St. Mary Pharmacy Bole',
      subCity: 'Bole',
      city: 'Addis Ababa',
      phone: '0911223344',
      telegramChatId: 'tg_user_99120',
      latitude: 9.0015,
      longitude: 38.7845,
      address: 'Cameroon St, Next to Edna Mall',
      isVerified: true,
      efdaLicenseNumber: 'EFDA/PH/AA/2024/3297',
      tinNumber: 'TIN-0083920194',
      tier: 'PREMIUM',
      trustScore: 98,
      strikeCount: 0,
      isShadowBanned: false,
      isPermanentlyBanned: false,
      inStockItems: ['ventolin inhaler 100mcg', 'amoxicillin 500mg'],
      inventory: [
        { name: 'Ventolin Inhaler 100mcg', genericName: 'Salbutamol', category: 'Respiratory', priceETB: 550, inStock: false, updatedAt: new Date().toISOString() },
        { name: 'Amoxicillin 500mg', genericName: 'Amoxicillin', category: 'Antibiotics', priceETB: 220, inStock: true, updatedAt: new Date().toISOString() },
      ],
      analyticsAccess: { enabled: true, tier: 'PRO', allowedSubCities: ['Bole'] },
    };
    this.pharmacies = [defaultPharm];
    this.createOrGetPharmacyAccount(defaultPharm, defaultPharm.telegramChatId);
  }

  private seedSearchTelemetry() {
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    
    // Seed high-demand searches reflecting actual Ethiopian shortages
    const seedEvents: Array<{ query: string; drug: string; subCity: string; count: number }> = [
      { query: 'Ventolin Inhaler 100mcg', drug: 'ventolin', subCity: 'Bole', count: 48 },
      { query: 'Ventolin Evohaler', drug: 'ventolin', subCity: 'Kirkos', count: 24 },
      { query: 'Insulin Humulin N', drug: 'insulin', subCity: 'Bole', count: 36 },
      { query: 'Augmentin 625mg', drug: 'augmentin', subCity: 'Bole', count: 31 },
      { query: 'Eltroxin 100mcg', drug: 'eltroxin', subCity: 'Bole', count: 42 },
      { query: 'Eltroxin 50mcg', drug: 'eltroxin', subCity: 'Yeka', count: 28 },
      { query: 'Ceftriaxone 1g', drug: 'ceftriaxone', subCity: 'Kirkos', count: 19 },
      { query: 'Metformin 850mg', drug: 'metformin', subCity: 'Bole', count: 25 },
      { query: 'Amlodipine 10mg', drug: 'amlodipine', subCity: 'Bole', count: 18 },
      { query: 'Paracetamol 500mg', drug: 'paracetamol', subCity: 'Bole', count: 15 },
    ];

    this.searchAnalyticsEvents = [];
    for (const item of seedEvents) {
      for (let i = 0; i < item.count; i++) {
        // distribute within last 7 days
        const offset = Math.floor(Math.random() * 7 * dayMs);
        this.searchAnalyticsEvents.push({
          id: `ev-${crypto.randomBytes(4).toString('hex')}`,
          query: item.query,
          normalizedDrug: item.drug,
          coreBrandOrGeneric: item.drug,
          subCity: item.subCity,
          city: 'Addis Ababa',
          matchedCount: item.drug === 'ventolin' ? 1 : item.drug === 'eltroxin' ? 0 : 2,
          userId: `patient_${Math.floor(1000 + Math.random() * 9000)}`,
          timestamp: new Date(now - offset).toISOString(),
        });
      }
    }
  }

  public getOrCreateSubscription(userId: string): UserSubscription {
    const currentMonth = new Date().toISOString().substring(0, 7); // YYYY-MM
    let sub = this.subscriptions.get(userId);

    if (!sub) {
      sub = {
        userId,
        plan: 'FREE_TIER',
        active: false,
        startsAt: new Date().toISOString(),
        expiresAt: new Date(0).toISOString(),
        monthlySearchesUsed: 0,
        lastSearchMonth: currentMonth,
      };
      this.subscriptions.set(userId, sub);
    } else if (sub.lastSearchMonth !== currentMonth) {
      sub.monthlySearchesUsed = 0;
      sub.lastSearchMonth = currentMonth;
    }

    return sub;
  }

  // --- ANTI-SCAM 1-HOUR PRICE-LOCK RESERVATION ENGINE ---

  public createReservationHold(params: {
    patientUserId: string;
    pharmacyId: string;
    medicineName: string;
    lockedPriceETB: number;
    durationMinutes?: number;
  }): ReservationHold | null {
    const pharmacy = this.pharmacies.find((p) => p.id === params.pharmacyId);
    if (!pharmacy || pharmacy.isPermanentlyBanned) return null;

    // Anti-Ghosting Quota: max 2 active holds per patient
    let activeCount = 0;
    for (const r of this.reservations.values()) {
      if (r.patientUserId === params.patientUserId && r.status === 'ACTIVE' && new Date() < new Date(r.expiresAt)) {
        activeCount++;
      }
    }
    if (activeCount >= 2) {
      console.warn(`[AntiGhosting] Patient ${params.patientUserId} exceeded active reservation quota (${activeCount}/2)`);
      return null;
    }

    // Generate readable 4-digit code e.g. "#7492"
    const randomCode = Math.floor(1000 + Math.random() * 9000).toString();
    const duration = params.durationMinutes || 60;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + duration * 60 * 1000).toISOString();

    const hold: ReservationHold = {
      reservationCode: randomCode,
      patientUserId: params.patientUserId,
      pharmacyId: pharmacy.id,
      pharmacyName: pharmacy.name,
      medicineName: params.medicineName,
      lockedPriceETB: params.lockedPriceETB,
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

    this.reservations.set(randomCode, hold);
    return hold;
  }

  public getReservationHold(code: string): ReservationHold | null {
    const cleanCode = code.trim().replace(/^#/, '').toUpperCase();
    for (const [k, v] of this.reservations.entries()) {
      if (k.toUpperCase() === cleanCode || k.replace(/^#/, '').toUpperCase() === cleanCode) {
        return v;
      }
    }
    return null;
  }

  public linkReservationPatientChatId(code: string, chatId: string): ReservationHold | null {
    const hold = this.getReservationHold(code);
    if (!hold) return null;
    hold.patientUserId = chatId;
    return hold;
  }

  public getActiveReservationsByPharmacy(pharmacyId: string): ReservationHold[] {
    const list: ReservationHold[] = [];
    for (const r of this.reservations.values()) {
      if (r.pharmacyId === pharmacyId && r.status === 'ACTIVE' && new Date() < new Date(r.expiresAt)) {
        list.push(r);
      }
    }
    return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  public confirmReservationHold(reservationCode: string): { success: boolean; message: string; reservation?: ReservationHold } {
    const hold = this.getReservationHold(reservationCode);
    if (!hold) return { success: false, message: 'Reservation code not found' };
    if (hold.status !== 'ACTIVE' || new Date() > new Date(hold.expiresAt)) {
      return { success: false, message: 'Reservation is no longer active or expired' };
    }
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 60 * 60 * 1000);
    hold.pharmacistAcknowledged = true;
    hold.acknowledgedAt = now.toISOString();
    hold.expiresAt = expiresAt.toISOString();
    return { success: true, message: 'Shelf stock physically confirmed and held at counter.', reservation: hold };
  }

  public rejectReservationHold(reservationCode: string, reason?: string): { success: boolean; message: string; reservation?: ReservationHold } {
    const hold = this.getReservationHold(reservationCode);
    if (!hold) return { success: false, message: 'Reservation code not found' };
    hold.status = 'CANCELLED';
    return { success: true, message: reason || 'Reservation cancelled by pharmacist (Out of stock / Sold out).', reservation: hold };
  }

  public verifyAndFulfillReservation(reservationCode: string): { success: boolean; message: string; reservation?: ReservationHold } {
    const cleanCode = reservationCode.trim().replace(/^#/, '');
    const hold = this.getReservationHold(cleanCode);
    if (!hold) return { success: false, message: 'Reservation code not found' };

    if (new Date() > new Date(hold.expiresAt)) {
      hold.status = 'EXPIRED';
      return { success: false, message: 'This reservation hold has expired (60-minute limit exceeded)' };
    }

    if (hold.status === 'CANCELLED') {
      return { success: false, message: 'This reservation hold was previously cancelled or marked out of stock.' };
    }

    hold.status = 'FULFILLED';

    // Boost pharmacy trust score slightly on honest fulfillment
    const pharmacy = this.pharmacies.find((p) => p.id === hold.pharmacyId);
    if (pharmacy && pharmacy.trustScore < 100) {
      pharmacy.trustScore = Math.min(100, pharmacy.trustScore + 1);
    }

    return {
      success: true,
      message: `Reservation #${cleanCode} verified successfully. Price locked at ${hold.lockedPriceETB} ETB.`,
      reservation: hold,
    };
  }

  // --- ANTI-SCAM DISPUTE & 3-STRIKE PENALTY ENGINE ---

  public reportViolation(params: {
    patientUserId: string;
    pharmacyId: string;
    medicineName: string;
    issueType: 'PRICE_GOUGING' | 'OUT_OF_STOCK_PHANTOM' | 'EXPIRED_MEDICINE' | 'UNPROFESSIONAL';
    description?: string;
  }): { success: boolean; strikeCount: number; newTrustScore: number; penaltyApplied: string } {
    const pharmacy = this.pharmacies.find((p) => p.id === params.pharmacyId);
    if (!pharmacy) return { success: false, strikeCount: 0, newTrustScore: 0, penaltyApplied: 'Pharmacy not found' };

    pharmacy.strikeCount += 1;
    pharmacy.trustScore = Math.max(10, pharmacy.trustScore - 15);

    let penaltyApplied = 'Formal Warning Logged';

    if (pharmacy.strikeCount === 1) {
      // 1st Strike: 48-hour shadowban from broadcasts
      pharmacy.isShadowBanned = true;
      const banUntil = new Date(Date.now() + 48 * 60 * 60 * 1000);
      pharmacy.shadowBanUntil = banUntil.toISOString();
      penaltyApplied = 'Strike 1: 48-Hour Broadcast Shadowban applied + Trust Score dropped by 15%.';
    } else if (pharmacy.strikeCount === 2) {
      // 2nd Strike: Revoke Verified badge
      pharmacy.isVerified = false;
      pharmacy.isShadowBanned = true;
      penaltyApplied = 'Strike 2: "Verified" EFDA Badge revoked and pharmacy deprioritized.';
    } else if (pharmacy.strikeCount >= 3) {
      // 3rd Strike: Permanent Ban
      pharmacy.isPermanentlyBanned = true;
      pharmacy.isVerified = false;
      pharmacy.inStockItems = [];
      pharmacy.inventory = [];
      penaltyApplied = 'Strike 3: Permanent Blacklist! License and TIN permanently banned from MedFinder.';
    }

    const report: PharmacyViolationReport = {
      id: `REP-${Date.now()}`,
      patientUserId: params.patientUserId,
      pharmacyId: pharmacy.id,
      pharmacyName: pharmacy.name,
      medicineName: params.medicineName,
      issueType: params.issueType,
      description: params.description,
      reportedAt: new Date().toISOString(),
      strikeApplied: true,
      newTrustScore: pharmacy.trustScore,
    };

    this.violationReports.push(report);

    return {
      success: true,
      strikeCount: pharmacy.strikeCount,
      newTrustScore: pharmacy.trustScore,
      penaltyApplied,
    };
  }

  // --- PHARMACY INVENTORY REGISTRATION METHODS ---

  public addOrUpdateMedicine(pharmacyId: string, item: { name: string; genericName?: string; category?: string; priceETB: number; inStock?: boolean }): boolean {
    const pharmacy = this.pharmacies.find((p) => p.id === pharmacyId);
    if (!pharmacy || pharmacy.isPermanentlyBanned) return false;

    const existingIndex = pharmacy.inventory.findIndex((i) => i.name.toLowerCase() === item.name.toLowerCase());
    const cleanLower = item.name.toLowerCase();

    if (existingIndex >= 0) {
      pharmacy.inventory[existingIndex] = {
        ...pharmacy.inventory[existingIndex],
        priceETB: item.priceETB,
        inStock: item.inStock !== undefined ? item.inStock : true,
        updatedAt: new Date().toISOString(),
      };
    } else {
      pharmacy.inventory.push({
        name: item.name,
        genericName: item.genericName || '',
        category: item.category || 'General',
        priceETB: item.priceETB,
        inStock: item.inStock !== undefined ? item.inStock : true,
        updatedAt: new Date().toISOString(),
      });
    }

    if (!pharmacy.inStockItems.includes(cleanLower)) {
      pharmacy.inStockItems.push(cleanLower);
    }

    return true;
  }

  public removeMedicine(pharmacyId: string, medicineName: string): boolean {
    const pharmacy = this.pharmacies.find((p) => p.id === pharmacyId);
    if (!pharmacy) return false;

    pharmacy.inventory = pharmacy.inventory.filter((i) => i.name.toLowerCase() !== medicineName.toLowerCase());
    pharmacy.inStockItems = pharmacy.inStockItems.filter((i) => !i.includes(medicineName.toLowerCase()));
    return true;
  }

  public toggleMedicineStock(pharmacyId: string, medicineName: string, inStock: boolean): boolean {
    const pharmacy = this.pharmacies.find((p) => p.id === pharmacyId);
    if (!pharmacy) return false;

    const item = pharmacy.inventory.find((i) => i.name.toLowerCase() === medicineName.toLowerCase());
    if (item) {
      item.inStock = inStock;
      item.updatedAt = new Date().toISOString();
      const lower = medicineName.toLowerCase();
      if (!inStock) {
        pharmacy.inStockItems = pharmacy.inStockItems.filter((i) => !i.includes(lower));
      } else if (!pharmacy.inStockItems.includes(lower)) {
        pharmacy.inStockItems.push(lower);
      }
      return true;
    }
    return false;
  }

  public updatePharmacyLocation(pharmacyId: string, data: { latitude: number; longitude: number; subCity?: string; addressDetails?: string }): { success: boolean; pharmacy?: Pharmacy; error?: string } {
    const pharmacy = this.pharmacies.find((p) => p.id === pharmacyId);
    if (!pharmacy) return { success: false, error: 'Pharmacy not found' };

    pharmacy.latitude = data.latitude;
    pharmacy.longitude = data.longitude;
    if (data.subCity) pharmacy.subCity = data.subCity;
    if (data.addressDetails) pharmacy.address = data.addressDetails;

    // Also update associated application if present
    const app = this.verificationApplications.find((a) => a.approvedPharmacyId === pharmacyId || a.pharmacyName.toLowerCase() === pharmacy.name.toLowerCase());
    if (app) {
      app.latitude = data.latitude;
      app.longitude = data.longitude;
      if (data.subCity) app.subCity = data.subCity;
      app.gpsLocationVerified = true;
    }

    return { success: true, pharmacy };
  }

  public bulkImportChecklist(pharmacyId: string, items: Array<{ name: string; priceETB: number; category?: string; genericName?: string }>): number {
    let count = 0;
    for (const item of items) {
      if (this.addOrUpdateMedicine(pharmacyId, item)) {
        count++;
      }
    }
    return count;
  }

  public parseAndImportCsv(pharmacyId: string, csvContent: string): { imported: number; errors: number } {
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
          this.addOrUpdateMedicine(pharmacyId, { name, priceETB, category });
          imported++;
        } else {
          errors++;
        }
      }
    }

    return { imported, errors };
  }

  private seedVerificationApplications() {
    this.verificationApplications = [];
  }

  public submitVerificationApplication(data: Omit<PharmacyVerificationApplication, 'id' | 'status' | 'submittedAt'>): PharmacyVerificationApplication {
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const newApp: PharmacyVerificationApplication = {
      id: `MF-VERIFY-${randomSuffix}`,
      status: 'PENDING_REVIEW',
      submittedAt: new Date().toISOString(),
      ...data,
    };
    this.verificationApplications.unshift(newApp);
    return newApp;
  }

  public reviewVerificationApplication(
    id: string,
    status: 'APPROVED' | 'REJECTED' | 'INFO_REQUESTED',
    adminNotes?: string,
    efdaLicenseNumber?: string
  ): { success: boolean; application?: PharmacyVerificationApplication; pharmacy?: Pharmacy; error?: string } {
    const app = this.verificationApplications.find((a) => a.id === id);
    if (!app) return { success: false, error: 'Application not found' };

    if (efdaLicenseNumber && efdaLicenseNumber.trim()) {
      app.efdaLicenseNumber = efdaLicenseNumber.trim();
    }
    app.status = status;
    app.reviewedAt = new Date().toISOString();
    if (adminNotes) {
      app.adminNotes = adminNotes;
      if (status === 'INFO_REQUESTED') {
        app.requestedInfoReason = adminNotes;
      }
    }

    // If Info is requested by Compliance Desk, prime the bot session for seamless resubmission
    if (status === 'INFO_REQUESTED') {
      let session = this.botSessions.get(app.telegramChatId);
      if (!session) {
        session = {
          chatId: app.telegramChatId,
          username: app.telegramUsername,
          step: 'AWAITING_INFO_UPDATE',
          updatingApplicationId: app.id,
          data: {},
          language: 'am',
        };
        this.botSessions.set(app.telegramChatId, session);
      } else {
        session.step = 'AWAITING_INFO_UPDATE';
        session.updatingApplicationId = app.id;
      }
    }

    let pharmacy: Pharmacy | undefined;

    if (status === 'APPROVED') {
      // Find matching existing pharmacy by approvedPharmacyId or exact EFDA license number
      const existing = this.pharmacies.find((p) => 
        (app.approvedPharmacyId && p.id === app.approvedPharmacyId) ||
        (app.efdaLicenseNumber && p.efdaLicenseNumber === app.efdaLicenseNumber)
      );

      if (existing) {
        existing.name = app.pharmacyName || existing.name;
        existing.subCity = app.subCity || existing.subCity;
        existing.phone = app.phone || existing.phone;
        existing.isVerified = true;
        existing.efdaLicenseNumber = app.efdaLicenseNumber || existing.efdaLicenseNumber;
        existing.tinNumber = app.tinNumber || existing.tinNumber;
        if (app.latitude !== undefined && app.longitude !== undefined) {
          existing.latitude = app.latitude;
          existing.longitude = app.longitude;
        }
        existing.trustScore = Math.max(existing.trustScore, 98);
        existing.strikeCount = 0;
        app.approvedPharmacyId = existing.id;
        pharmacy = existing;
      } else {
        const cleanSubCity = (app.subCity || 'Bole').toLowerCase().replace(/[^a-z]/g, '') || 'bole';
        const newPharmId = `pharm-${cleanSubCity}-${Math.floor(1000 + Math.random() * 9000)}`;
        const subCityCoords: Record<string, { lat: number; lng: number }> = {
          Bole: { lat: 9.0015, lng: 38.7845 },
          Kirkos: { lat: 9.0105, lng: 38.7455 },
          Yeka: { lat: 9.0201, lng: 38.8021 },
          Arada: { lat: 9.0345, lng: 38.7512 },
          'Nifas Silk': { lat: 8.9567, lng: 38.7612 },
        };
        const defaultCoords = subCityCoords[app.subCity] || { lat: 9.01, lng: 38.76 };
        const finalLat = app.latitude !== undefined ? app.latitude : defaultCoords.lat;
        const finalLng = app.longitude !== undefined ? app.longitude : defaultCoords.lng;

        const newPharm: Pharmacy = {
          id: newPharmId,
          name: app.pharmacyName,
          subCity: app.subCity,
          city: 'Addis Ababa',
          latitude: finalLat,
          longitude: finalLng,
          phone: app.phone,
          telegramChatId: app.telegramChatId,
          isVerified: true,
          efdaLicenseNumber: app.efdaLicenseNumber,
          tinNumber: app.tinNumber,
          tier: 'PREMIUM',
          trustScore: 98,
          strikeCount: 0,
          isShadowBanned: false,
          isPermanentlyBanned: false,
          inStockItems: ['insulin', 'augmentin', 'amoxicillin', 'metformin', 'ventolin'],
          inventory: [
            {
              name: 'Insulin (Humulin N / Regular)',
              genericName: 'Human Insulin',
              category: 'Diabetes',
              priceETB: 440,
              inStock: true,
              updatedAt: new Date().toISOString(),
            },
            {
              name: 'Augmentin 625mg / 1g',
              genericName: 'Amoxicillin + Clavulanic Acid',
              category: 'Antibiotics',
              priceETB: 380,
              inStock: true,
              updatedAt: new Date().toISOString(),
            },
            {
              name: 'Metformin 500mg / 850mg',
              genericName: 'Metformin Hydrochloride',
              category: 'Diabetes',
              priceETB: 120,
              inStock: true,
              updatedAt: new Date().toISOString(),
            },
          ],
        };
        // Unshift to put newly approved pharmacy right at the top
        this.pharmacies.unshift(newPharm);
        app.approvedPharmacyId = newPharm.id;
        pharmacy = newPharm;
      }
    } else if (status === 'REJECTED') {
      if (app.approvedPharmacyId) {
        const existing = this.pharmacies.find((p) => p.id === app.approvedPharmacyId);
        if (existing) {
          existing.isVerified = false;
        }
      }
    }

    if (status === 'APPROVED' && pharmacy) {
      const portalAcc = this.createOrGetPharmacyAccount(pharmacy, app.telegramChatId);
      app.portalAccessKey = portalAcc.accessKey;
      app.portalUsername = portalAcc.accessKey;
      app.portalSetupToken = portalAcc.accessKey;
    }

    return { success: true, application: app, pharmacy };
  }

  public resubmitVerificationApplication(
    id: string,
    updates: {
      photoUrl?: string;
      efdaLicenseNumber?: string;
      tinNumber?: string;
      location?: { latitude: number; longitude: number; subCity?: string; addressDetails?: string };
      note?: string;
    }
  ): PharmacyVerificationApplication | null {
    const app = this.verificationApplications.find((a) => a.id === id);
    if (!app) return null;

    if (updates.photoUrl) {
      app.efdaDocUrl = updates.photoUrl;
      app.counterPhotoUrl = updates.photoUrl;
    }
    if (updates.efdaLicenseNumber) {
      app.efdaLicenseNumber = updates.efdaLicenseNumber;
    }
    if (updates.tinNumber) {
      app.tinNumber = updates.tinNumber;
    }
    if (updates.location) {
      app.latitude = updates.location.latitude;
      app.longitude = updates.location.longitude;
      if (updates.location.subCity) app.subCity = updates.location.subCity;
      if (updates.location.addressDetails) app.addressDetails = updates.location.addressDetails;
      app.gpsLocationVerified = true;
    }

    app.status = 'RESUBMITTED';
    app.resubmittedAt = new Date().toISOString();
    app.pharmacistUpdateNote = updates.note || 'Applicant uploaded updated verification materials';
    const prevReason = app.requestedInfoReason ? ` (In response to: "${app.requestedInfoReason}")` : '';
    app.adminNotes = `[Resubmission Received]: ${app.pharmacistUpdateNote}${prevReason}`;

    return app;
  }

  public static hashPassword(password: string): string {
    return crypto.createHash('sha256').update(password + '_medfinder_ethiopia_salt').digest('hex');
  }

  /**
   * Passwordless 1-Click Account Provisioner:
   * Creates or returns the pharmacy's cryptographic accessKey and 180-day persistent session token.
   */
  public createOrGetPharmacyAccount(pharmacy: Pharmacy, telegramChatId?: string): PharmacyPortalAccount {
    // Check if account already exists for this pharmacy
    for (const acc of this.pharmacyAccounts.values()) {
      if (acc.pharmacyId === pharmacy.id) {
        if (telegramChatId && !acc.telegramChatId) {
          acc.telegramChatId = telegramChatId;
        }
        return acc;
      }
    }

    // Generate cryptographic 1-Click Magic Key (bank-grade entropy)
    const accessKey = 'mf_key_' + crypto.randomBytes(24).toString('hex');
    // Generate 6-month (180 days) persistent counter session token
    const sessionToken = 'sess_' + crypto.randomBytes(32).toString('hex');
    const sessionExpiresAt = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString();

    const account: PharmacyPortalAccount = {
      id: `acc-${crypto.randomBytes(6).toString('hex')}`,
      pharmacyId: pharmacy.id,
      pharmacyName: pharmacy.name,
      subCity: pharmacy.subCity,
      phone: pharmacy.phone,
      accessKey,
      telegramChatId,
      sessionToken,
      sessionExpiresAt,
      createdAt: new Date().toISOString(),
      lastLoginAt: new Date().toISOString(),
    };

    this.pharmacyAccounts.set(pharmacy.id, account);
    this.pharmacyAccounts.set(accessKey, account);
    return account;
  }

  /**
   * Passwordless 1-Click Magic Login with Access Key:
   * Unlocks the counter device and refreshes 6-month persistent session.
   */
  public magicLoginWithKey(accessKey: string): { success: boolean; account?: PharmacyPortalAccount; token?: string; sessionExpiresAt?: string; error?: string } {
    if (!accessKey) return { success: false, error: 'Access key is required' };
    const cleanKey = accessKey.trim();

    let targetAcc: PharmacyPortalAccount | undefined;
    for (const acc of this.pharmacyAccounts.values()) {
      if (acc.accessKey === cleanKey || acc.setupToken === cleanKey) {
        targetAcc = acc;
        break;
      }
    }

    if (!targetAcc) {
      return { success: false, error: 'Invalid or unrecognized 1-Click access key. Open @MedFinder_Verifier_bot and type /key to get a new link.' };
    }

    // Refresh 180-day persistent session token
    targetAcc.sessionToken = 'sess_' + crypto.randomBytes(32).toString('hex');
    targetAcc.sessionExpiresAt = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString();
    targetAcc.lastLoginAt = new Date().toISOString();

    return {
      success: true,
      account: targetAcc,
      token: targetAcc.sessionToken,
      sessionExpiresAt: targetAcc.sessionExpiresAt,
    };
  }

  /**
   * Fast Phone Sign-In: Request 4-digit OTP to Telegram chat
   */
  public sendPharmacyLoginOtp(phone: string): { success: boolean; otpCode?: string; telegramChatId?: string; pharmacyName?: string; error?: string } {
    const cleanPhone = phone.trim().replace(/[^0-9]/g, '');
    let targetAcc: PharmacyPortalAccount | undefined;

    for (const acc of this.pharmacyAccounts.values()) {
      const p = (acc.phone || '').replace(/[^0-9]/g, '');
      if (p && cleanPhone && (p === cleanPhone || p.endsWith(cleanPhone) || cleanPhone.endsWith(p))) {
        targetAcc = acc;
        break;
      }
    }

    if (!targetAcc) {
      return { success: false, error: 'No registered pharmacy found with this phone number. Please register via @MedFinder_Verifier_bot.' };
    }

    const otpCode = Math.floor(1000 + Math.random() * 9000).toString();
    targetAcc.lastOtpCode = otpCode;
    targetAcc.lastOtpExpiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 minutes

    return {
      success: true,
      otpCode,
      telegramChatId: targetAcc.telegramChatId,
      pharmacyName: targetAcc.pharmacyName,
    };
  }

  /**
   * Fast Phone Sign-In: Verify 4-digit OTP and issue 6-month persistent session
   */
  public verifyPharmacyLoginOtp(phone: string, otpCode: string): { success: boolean; account?: PharmacyPortalAccount; token?: string; sessionExpiresAt?: string; error?: string } {
    const cleanPhone = phone.trim().replace(/[^0-9]/g, '');
    let targetAcc: PharmacyPortalAccount | undefined;

    for (const acc of this.pharmacyAccounts.values()) {
      const p = (acc.phone || '').replace(/[^0-9]/g, '');
      if (p && cleanPhone && (p === cleanPhone || p.endsWith(cleanPhone) || cleanPhone.endsWith(p))) {
        targetAcc = acc;
        break;
      }
    }

    if (!targetAcc) {
      return { success: false, error: 'Pharmacy account not found' };
    }

    if (!targetAcc.lastOtpCode || targetAcc.lastOtpCode !== otpCode.trim()) {
      return { success: false, error: 'Invalid 4-digit code. Please check your Telegram message and retry.' };
    }

    if (targetAcc.lastOtpExpiresAt && new Date(targetAcc.lastOtpExpiresAt).getTime() < Date.now()) {
      return { success: false, error: 'Login code has expired (10 minutes limit). Please request a new code.' };
    }

    delete targetAcc.lastOtpCode;
    delete targetAcc.lastOtpExpiresAt;

    targetAcc.sessionToken = 'sess_' + crypto.randomBytes(32).toString('hex');
    targetAcc.sessionExpiresAt = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString();
    targetAcc.lastLoginAt = new Date().toISOString();

    return {
      success: true,
      account: targetAcc,
      token: targetAcc.sessionToken,
      sessionExpiresAt: targetAcc.sessionExpiresAt,
    };
  }

  /**
   * Get pharmacy portal account by session token (enforcing 180-day validity)
   */
  public getAccountBySession(token: string): PharmacyPortalAccount | undefined {
    if (!token) return undefined;
    for (const acc of this.pharmacyAccounts.values()) {
      if (acc.sessionToken === token) {
        // Enforce 180-day validity
        if (acc.sessionExpiresAt && new Date(acc.sessionExpiresAt).getTime() < Date.now()) {
          return undefined; // Expired
        }
        return acc;
      }
    }
    return undefined;
  }

  public getAccountByAccessKey(accessKey: string): PharmacyPortalAccount | undefined {
    if (!accessKey) return undefined;
    const cleanKey = accessKey.trim();
    for (const acc of this.pharmacyAccounts.values()) {
      if (acc.accessKey === cleanKey) return acc;
    }
    return undefined;
  }

  public getAccountByPharmacyId(pharmacyId: string): PharmacyPortalAccount | undefined {
    if (!pharmacyId) return undefined;
    for (const acc of this.pharmacyAccounts.values()) {
      if (acc.pharmacyId === pharmacyId) return acc;
    }
    return undefined;
  }

  public getAccountByTelegramChatId(chatId: string): PharmacyPortalAccount | undefined {
    if (!chatId) return undefined;
    for (const acc of this.pharmacyAccounts.values()) {
      if (acc.telegramChatId === chatId) return acc;
    }
    return undefined;
  }

  // Deprecated backward-compatibility aliases
  public getAccountBySetupToken(setupToken: string): PharmacyPortalAccount | undefined {
    return this.getAccountByAccessKey(setupToken);
  }

  public authenticatePharmacy(username: string, _password?: string): { success: boolean; account?: PharmacyPortalAccount; token?: string; error?: string } {
    return this.magicLoginWithKey(username);
  }

  public changePharmacyPassword(_username: string, _curr: string, _new: string): { success: boolean; error?: string } {
    return { success: true };
  }

  public activateAccountWithToken(setupToken: string, _newPass?: string): { success: boolean; account?: PharmacyPortalAccount; token?: string; error?: string } {
    return this.magicLoginWithKey(setupToken);
  }

  private seedDefaultAdmin() {
    const defaultUsername = 'admin';
    const defaultPassword = process.env.ADMIN_DEFAULT_PASSWORD || 'Admin@MedFinder2026!';
    const passwordHash = InMemoryDatabase.hashPassword(defaultPassword);

    const masterAdmin: AdminUser = {
      id: 'adm-super-01',
      username: defaultUsername,
      fullName: 'Chief Regulatory Administrator',
      email: 'admin@efda.gov.et',
      role: 'SUPER_ADMIN',
      privileges: {
        canReviewApplications: true,
        canManagePolicies: true,
        canManageAdmins: true,
        canViewAuditLogs: true,
      },
      passwordHash,
      createdAt: new Date().toISOString(),
    };

    this.adminUsers.set(defaultUsername, masterAdmin);
  }

  public authenticateAdmin(username: string, password: string): { success: boolean; admin?: Omit<AdminUser, 'passwordHash'>; token?: string; error?: string } {
    const user = this.adminUsers.get(username.trim().toLowerCase());
    if (!user) {
      return { success: false, error: 'Invalid administrator credentials' };
    }

    const hash = InMemoryDatabase.hashPassword(password);
    if (user.passwordHash !== hash) {
      return { success: false, error: 'Invalid administrator credentials' };
    }

    user.sessionToken = 'adm_sess_' + crypto.randomBytes(16).toString('hex');
    user.lastLoginAt = new Date().toISOString();

    const { passwordHash, ...safeAdmin } = user;
    return {
      success: true,
      admin: safeAdmin,
      token: user.sessionToken,
    };
  }

  public getAdminBySession(token: string): AdminUser | undefined {
    if (!token) return undefined;
    for (const adm of this.adminUsers.values()) {
      if (adm.sessionToken === token) return adm;
    }
    return undefined;
  }

  public listAdmins(): Array<Omit<AdminUser, 'passwordHash'>> {
    return Array.from(this.adminUsers.values()).map(({ passwordHash, ...rest }) => rest);
  }

  public createAdmin(data: {
    username: string;
    fullName: string;
    email: string;
    password: string;
    role: AdminRole;
    privileges?: Partial<AdminPrivileges>;
  }): { success: boolean; admin?: Omit<AdminUser, 'passwordHash'>; error?: string } {
    const cleanUsername = data.username.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (!cleanUsername || cleanUsername.length < 3) {
      return { success: false, error: 'Username must be at least 3 alphanumeric characters' };
    }

    if (this.adminUsers.has(cleanUsername)) {
      return { success: false, error: 'An administrator with this username already exists' };
    }

    if (!data.password || data.password.length < 8) {
      return { success: false, error: 'Password must be at least 8 characters long' };
    }

    const defaultPrivileges: AdminPrivileges = data.role === 'SUPER_ADMIN'
      ? { canReviewApplications: true, canManagePolicies: true, canManageAdmins: true, canViewAuditLogs: true }
      : data.role === 'EFDA_OFFICER'
        ? { canReviewApplications: true, canManagePolicies: false, canManageAdmins: false, canViewAuditLogs: true }
        : { canReviewApplications: false, canManagePolicies: false, canManageAdmins: false, canViewAuditLogs: true };

    const finalPrivileges: AdminPrivileges = {
      ...defaultPrivileges,
      ...(data.privileges || {}),
    };

    const newAdmin: AdminUser = {
      id: `adm-${crypto.randomBytes(4).toString('hex')}`,
      username: cleanUsername,
      fullName: data.fullName || cleanUsername,
      email: data.email || `${cleanUsername}@efda.gov.et`,
      role: data.role,
      privileges: finalPrivileges,
      passwordHash: InMemoryDatabase.hashPassword(data.password),
      createdAt: new Date().toISOString(),
    };

    this.adminUsers.set(cleanUsername, newAdmin);
    const { passwordHash, ...safeUser } = newAdmin;
    return { success: true, admin: safeUser };
  }

  public updateAdminPrivileges(adminId: string, updates: { role?: AdminRole; privileges?: Partial<AdminPrivileges> }): { success: boolean; admin?: Omit<AdminUser, 'passwordHash'>; error?: string } {
    let target: AdminUser | undefined;
    for (const adm of this.adminUsers.values()) {
      if (adm.id === adminId) {
        target = adm;
        break;
      }
    }

    if (!target) return { success: false, error: 'Administrator user not found' };

    if (updates.role) target.role = updates.role;
    if (updates.privileges) {
      target.privileges = {
        ...target.privileges,
        ...updates.privileges,
      };
    }

    const { passwordHash, ...safeUser } = target;
    return { success: true, admin: safeUser };
  }

  public deleteAdmin(adminId: string): { success: boolean; error?: string } {
    let targetKey: string | undefined;
    let superAdminCount = 0;

    for (const [key, adm] of this.adminUsers.entries()) {
      if (adm.role === 'SUPER_ADMIN') superAdminCount++;
      if (adm.id === adminId) targetKey = key;
    }

    if (!targetKey) return { success: false, error: 'Administrator user not found' };

    const targetUser = this.adminUsers.get(targetKey);
    if (targetUser?.role === 'SUPER_ADMIN' && superAdminCount <= 1) {
      return { success: false, error: 'Security constraint: Cannot delete the only remaining Super Admin account' };
    }

    this.adminUsers.delete(targetKey);
    return { success: true };
  }

  // ==========================================
  // B2B WHOLESALE MARKETPLACE (MEDSUPPLY EXCHANGE)
  // ==========================================
  private seedWholesaleMarketplace() {
    this.wholesalers = [
      {
        id: 'wholesaler_cadila',
        name: 'Cadila Pharmaceuticals Ethiopia PLC',
        subCity: 'Kirkos / Churchill Road',
        city: 'Addis Ababa',
        phone: '0911-203490',
        telegramChatId: 'tg_wholesaler_cadila',
        efdaWholesaleLicense: 'EFDA/WHOLESALE/AA-7718',
        tinNumber: 'TIN-0019283741',
        isVerified: true,
        trustScore: 99,
        deliveryTerms: 'Same-Day Dispatch (Within 2 Hours in Addis Ababa) • Cold-Chain Certified',
        minimumOrderValueETB: 2000,
      },
      {
        id: 'wholesaler_medtech',
        name: 'Medtech Ethiopia Importers & Distributors',
        subCity: 'Gotera / Nifas Silk',
        city: 'Addis Ababa',
        phone: '0911-554433',
        telegramChatId: 'tg_wholesaler_medtech',
        efdaWholesaleLicense: 'EFDA/WHOLESALE/AA-8842',
        tinNumber: 'TIN-0028391024',
        isVerified: true,
        trustScore: 98,
        deliveryTerms: 'Scheduled Express Delivery (Within 3 Hours) • Free on Orders >10,000 ETB',
        minimumOrderValueETB: 3000,
      },
      {
        id: 'wholesaler_epharm',
        name: 'EPHARM & Sante Importers PLC',
        subCity: 'Kirkos / Stadium',
        city: 'Addis Ababa',
        phone: '0911-889900',
        telegramChatId: 'tg_wholesaler_epharm',
        efdaWholesaleLicense: 'EFDA/WHOLESALE/AA-5531',
        tinNumber: 'TIN-0039281745',
        isVerified: true,
        trustScore: 97,
        deliveryTerms: 'Same-Day Counter Dropoff (Within 4 Hours) • Batch Analysis Certificate Included',
        minimumOrderValueETB: 1500,
      },
    ];

    const now = new Date().toISOString();
    this.wholesaleListings = [
      {
        id: 'wlist-ventolin-01',
        wholesalerId: 'wholesaler_cadila',
        wholesalerName: 'Cadila Pharmaceuticals Ethiopia PLC',
        wholesalerPhone: '0911-203490',
        wholesalerSubCity: 'Kirkos / Churchill Road',
        drugName: 'Ventolin Inhaler 100mcg',
        genericName: 'Salbutamol Sulfate',
        category: 'Respiratory',
        wholesalePriceETB: 420,
        retailMspETB: 650,
        minimumOrderQty: 10,
        availableStock: 850,
        batchNumber: 'BN-2025-VNT41',
        expiryDate: '11/2027',
        efdaRegistrationNo: 'EFDA-REG-ET-84920',
        originCountry: 'UK / GlaxoSmithKline',
        deliveryEstimateHours: 2,
        isActive: true,
        updatedAt: now,
      },
      {
        id: 'wlist-ventolin-02',
        wholesalerId: 'wholesaler_medtech',
        wholesalerName: 'Medtech Ethiopia Importers & Distributors',
        wholesalerPhone: '0911-554433',
        wholesalerSubCity: 'Gotera / Nifas Silk',
        drugName: 'Ventolin Evohaler 100mcg',
        genericName: 'Salbutamol Sulfate',
        category: 'Respiratory',
        wholesalePriceETB: 435,
        retailMspETB: 680,
        minimumOrderQty: 15,
        availableStock: 600,
        batchNumber: 'BN-2025-VNT92',
        expiryDate: '08/2027',
        efdaRegistrationNo: 'EFDA-REG-ET-84921',
        originCountry: 'France / GSK',
        deliveryEstimateHours: 3,
        isActive: true,
        updatedAt: now,
      },
      {
        id: 'wlist-insulin-01',
        wholesalerId: 'wholesaler_cadila',
        wholesalerName: 'Cadila Pharmaceuticals Ethiopia PLC',
        wholesalerPhone: '0911-203490',
        wholesalerSubCity: 'Kirkos / Churchill Road',
        drugName: 'Insulin Humulin N 100 IU/ml',
        genericName: 'Isophane Insulin Human (NPH)',
        category: 'Diabetes',
        wholesalePriceETB: 540,
        retailMspETB: 850,
        minimumOrderQty: 5,
        availableStock: 320,
        batchNumber: 'BN-2025-INS11',
        expiryDate: '05/2027',
        efdaRegistrationNo: 'EFDA-REG-ET-91024',
        originCountry: 'France / Eli Lilly',
        deliveryEstimateHours: 2,
        isActive: true,
        updatedAt: now,
      },
      {
        id: 'wlist-insulin-02',
        wholesalerId: 'wholesaler_epharm',
        wholesalerName: 'EPHARM & Sante Importers PLC',
        wholesalerPhone: '0911-889900',
        wholesalerSubCity: 'Kirkos / Stadium',
        drugName: 'Insulin Mixtard 30/70 100 IU/ml',
        genericName: 'Biphasic Isophane Insulin',
        category: 'Diabetes',
        wholesalePriceETB: 580,
        retailMspETB: 900,
        minimumOrderQty: 5,
        availableStock: 240,
        batchNumber: 'BN-2025-MX70',
        expiryDate: '09/2027',
        efdaRegistrationNo: 'EFDA-REG-ET-91088',
        originCountry: 'Denmark / Novo Nordisk',
        deliveryEstimateHours: 3,
        isActive: true,
        updatedAt: now,
      },
      {
        id: 'wlist-augmentin-01',
        wholesalerId: 'wholesaler_medtech',
        wholesalerName: 'Medtech Ethiopia Importers & Distributors',
        wholesalerPhone: '0911-554433',
        wholesalerSubCity: 'Gotera / Nifas Silk',
        drugName: 'Augmentin 625mg / 1g',
        genericName: 'Amoxicillin + Clavulanic Acid',
        category: 'Antibiotics',
        wholesalePriceETB: 280,
        retailMspETB: 450,
        minimumOrderQty: 20,
        availableStock: 1200,
        batchNumber: 'BN-2025-AUG62',
        expiryDate: '03/2028',
        efdaRegistrationNo: 'EFDA-REG-ET-77192',
        originCountry: 'UK / GSK',
        deliveryEstimateHours: 3,
        isActive: true,
        updatedAt: now,
      },
      {
        id: 'wlist-eltroxin-01',
        wholesalerId: 'wholesaler_epharm',
        wholesalerName: 'EPHARM & Sante Importers PLC',
        wholesalerPhone: '0911-889900',
        wholesalerSubCity: 'Kirkos / Stadium',
        drugName: 'Eltroxin 50mcg / 100mcg',
        genericName: 'Levothyroxine Sodium',
        category: 'Thyroid',
        wholesalePriceETB: 340,
        retailMspETB: 550,
        minimumOrderQty: 10,
        availableStock: 400,
        batchNumber: 'BN-2025-ELT10',
        expiryDate: '01/2028',
        efdaRegistrationNo: 'EFDA-REG-ET-66129',
        originCountry: 'South Africa / Aspen',
        deliveryEstimateHours: 4,
        isActive: true,
        updatedAt: now,
      },
      {
        id: 'wlist-ceftriaxone-01',
        wholesalerId: 'wholesaler_cadila',
        wholesalerName: 'Cadila Pharmaceuticals Ethiopia PLC',
        wholesalerPhone: '0911-203490',
        wholesalerSubCity: 'Kirkos / Churchill Road',
        drugName: 'Ceftriaxone 1g Vial',
        genericName: 'Ceftriaxone Sodium',
        category: 'Injectables',
        wholesalePriceETB: 85,
        retailMspETB: 150,
        minimumOrderQty: 50,
        availableStock: 2500,
        batchNumber: 'BN-2025-CEF1G',
        expiryDate: '12/2027',
        efdaRegistrationNo: 'EFDA-REG-ET-55102',
        originCountry: 'India / Cadila',
        deliveryEstimateHours: 2,
        isActive: true,
        updatedAt: now,
      },
      {
        id: 'wlist-metformin-01',
        wholesalerId: 'wholesaler_cadila',
        wholesalerName: 'Cadila Pharmaceuticals Ethiopia PLC',
        wholesalerPhone: '0911-203490',
        wholesalerSubCity: 'Kirkos / Churchill Road',
        drugName: 'Metformin 500mg / 850mg',
        genericName: 'Metformin Hydrochloride',
        category: 'Diabetes',
        wholesalePriceETB: 80,
        retailMspETB: 130,
        minimumOrderQty: 20,
        availableStock: 1500,
        batchNumber: 'BN-2025-MET85',
        expiryDate: '06/2028',
        efdaRegistrationNo: 'EFDA-REG-ET-44910',
        originCountry: 'India / Cadila',
        deliveryEstimateHours: 2,
        isActive: true,
        updatedAt: now,
      },
      {
        id: 'wlist-amlodipine-01',
        wholesalerId: 'wholesaler_medtech',
        wholesalerName: 'Medtech Ethiopia Importers & Distributors',
        wholesalerPhone: '0911-554433',
        wholesalerSubCity: 'Gotera / Nifas Silk',
        drugName: 'Amlodipine 5mg / 10mg',
        genericName: 'Amlodipine Besylate',
        category: 'Hypertension',
        wholesalePriceETB: 90,
        retailMspETB: 160,
        minimumOrderQty: 20,
        availableStock: 900,
        batchNumber: 'BN-2025-AML10',
        expiryDate: '10/2027',
        efdaRegistrationNo: 'EFDA-REG-ET-33291',
        originCountry: 'Germany / Sandoz',
        deliveryEstimateHours: 3,
        isActive: true,
        updatedAt: now,
      },
      {
        id: 'wlist-atorvastatin-01',
        wholesalerId: 'wholesaler_epharm',
        wholesalerName: 'EPHARM & Sante Importers PLC',
        wholesalerPhone: '0911-889900',
        wholesalerSubCity: 'Kirkos / Stadium',
        drugName: 'Atorvastatin 20mg (Lipitor)',
        genericName: 'Atorvastatin Calcium',
        category: 'Cardiovascular',
        wholesalePriceETB: 160,
        retailMspETB: 280,
        minimumOrderQty: 15,
        availableStock: 750,
        batchNumber: 'BN-2025-ATV20',
        expiryDate: '04/2028',
        efdaRegistrationNo: 'EFDA-REG-ET-22190',
        originCountry: 'Ireland / Pfizer',
        deliveryEstimateHours: 4,
        isActive: true,
        updatedAt: now,
      },
    ];

    this.wholesalePurchaseOrders = [
      {
        id: 'PO-77291',
        poNumber: 'PO-77291',
        pharmacyId: 'pharm-bole-3527',
        pharmacyName: 'St. Mary Pharmacy Bole',
        pharmacySubCity: 'Bole',
        pharmacyPhone: '0911223344',
        wholesalerId: 'wholesaler_cadila',
        wholesalerName: 'Cadila Pharmaceuticals Ethiopia PLC',
        listingId: 'wlist-ventolin-01',
        drugName: 'Ventolin Inhaler 100mcg',
        quantity: 30,
        unitPriceETB: 420,
        totalPriceETB: 12600,
        platformFeeRate: 0.02,
        platformFeeETB: 252,
        deliveryAddress: 'St. Mary Pharmacy Bole, Cameroon St, Addis Ababa',
        paymentMethod: 'COD',
        status: 'DELIVERED',
        statusNotes: 'Delivered in 90 minutes. 2% Platform Fee recorded for weekly settlement.',
        createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
        updatedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000 + 90 * 60 * 1000).toISOString(),
      }
    ];
  }

  public getWholesaleListings(filter?: { drugName?: string; category?: string; wholesalerId?: string; inStockOnly?: boolean }): WholesaleListing[] {
    let result = [...this.wholesaleListings.filter((l) => l.isActive)];
    if (filter?.wholesalerId) {
      result = result.filter((l) => l.wholesalerId === filter.wholesalerId);
    }
    if (filter?.category && filter.category !== 'ALL') {
      result = result.filter((l) => l.category.toLowerCase() === filter.category!.toLowerCase());
    }
    if (filter?.inStockOnly) {
      result = result.filter((l) => l.availableStock > 0);
    }
    if (filter?.drugName) {
      const q = filter.drugName.toLowerCase().trim();
      result = result.filter((l) =>
        l.drugName.toLowerCase().includes(q) ||
        (l.genericName && l.genericName.toLowerCase().includes(q))
      );
    }
    return result.sort((a, b) => a.wholesalePriceETB - b.wholesalePriceETB);
  }

  public getWholesaleListingById(id: string): WholesaleListing | undefined {
    return this.wholesaleListings.find((l) => l.id === id);
  }

  public matchWholesaleStockForDrug(drugName: string): WholesaleListing[] {
    const q = drugName.toLowerCase().replace(/[^a-z0-9]/g, ' ').trim();
    const tokens = q.split(/\s+/).filter((t) => t.length > 2);

    return this.wholesaleListings.filter((l) => {
      if (!l.isActive || l.availableStock <= 0) return false;
      const combined = `${l.drugName} ${l.genericName || ''} ${l.category}`.toLowerCase();
      if (combined.includes(q)) return true;
      return tokens.some((t) => combined.includes(t));
    }).sort((a, b) => a.wholesalePriceETB - b.wholesalePriceETB);
  }

  public createWholesalePurchaseOrder(orderData: {
    pharmacyId: string;
    listingId: string;
    quantity: number;
    deliveryAddress?: string;
    paymentMethod?: 'COD' | 'TELEBIRR' | 'CBE_BIRR';
    statusNotes?: string;
  }): { success: boolean; order?: WholesalePurchaseOrder; error?: string } {
    const listing = this.wholesaleListings.find((l) => l.id === orderData.listingId);
    if (!listing) return { success: false, error: 'Wholesale inventory listing not found' };

    const pharmacy = this.pharmacies.find((p) => p.id === orderData.pharmacyId);
    const account = Array.from(this.pharmacyAccounts.values()).find((a) => a.pharmacyId === orderData.pharmacyId);
    const pharmacyName = pharmacy?.name || account?.pharmacyName || 'Verified Counter Pharmacy';
    const pharmacySubCity = pharmacy?.subCity || account?.subCity || 'Bole';
    const pharmacyPhone = pharmacy?.phone || account?.phone || '0911000000';

    if (orderData.quantity < listing.minimumOrderQty) {
      return {
        success: false,
        error: `Order quantity (${orderData.quantity}) is below the Minimum Order Quantity (MOQ) of ${listing.minimumOrderQty} units for this importer.`
      };
    }

    if (orderData.quantity > listing.availableStock) {
      return {
        success: false,
        error: `Requested quantity (${orderData.quantity}) exceeds currently verified batch stock (${listing.availableStock} units).`
      };
    }

    // Decrement wholesale stock
    listing.availableStock -= orderData.quantity;

    const unitPriceETB = listing.wholesalePriceETB;
    const totalPriceETB = unitPriceETB * orderData.quantity;
    const platformFeeRate = 0.02; // 2%
    const platformFeeETB = Math.round(totalPriceETB * platformFeeRate * 100) / 100;

    const poNumber = `PO-${Math.floor(10000 + Math.random() * 90000)}`;
    const order: WholesalePurchaseOrder = {
      id: poNumber,
      poNumber,
      pharmacyId: orderData.pharmacyId,
      pharmacyName,
      pharmacySubCity,
      pharmacyPhone,
      wholesalerId: listing.wholesalerId,
      wholesalerName: listing.wholesalerName,
      listingId: listing.id,
      drugName: listing.drugName,
      quantity: orderData.quantity,
      unitPriceETB,
      totalPriceETB,
      platformFeeRate,
      platformFeeETB,
      deliveryAddress: orderData.deliveryAddress || `${pharmacyName}, ${pharmacySubCity}, Addis Ababa`,
      paymentMethod: orderData.paymentMethod || 'COD',
      status: 'CONFIRMED',
      statusNotes: orderData.statusNotes || `Purchase order locked with ${listing.wholesalerName}. Scheduled for same-day dispatch.`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.wholesalePurchaseOrders.unshift(order);
    return { success: true, order };
  }

  public getWholesaleOrders(filter?: { pharmacyId?: string; wholesalerId?: string; status?: string }): WholesalePurchaseOrder[] {
    let result = [...this.wholesalePurchaseOrders];
    if (filter?.pharmacyId) {
      result = result.filter((o) => o.pharmacyId === filter.pharmacyId);
    }
    if (filter?.wholesalerId) {
      result = result.filter((o) => o.wholesalerId === filter.wholesalerId);
    }
    if (filter?.status) {
      result = result.filter((o) => o.status === filter.status);
    }
    return result;
  }

  public updateWholesaleOrderStatus(
    orderId: string,
    status: 'PENDING' | 'CONFIRMED' | 'DISPATCHED' | 'DELIVERED' | 'CANCELLED',
    statusNotes?: string
  ): { success: boolean; order?: WholesalePurchaseOrder; error?: string } {
    const order = this.wholesalePurchaseOrders.find((o) => o.id === orderId);
    if (!order) return { success: false, error: 'Purchase order not found' };

    order.status = status;
    if (statusNotes) order.statusNotes = statusNotes;
    order.updatedAt = new Date().toISOString();

    // If cancelled, return stock back
    if (status === 'CANCELLED') {
      const listing = this.wholesaleListings.find((l) => l.id === order.listingId);
      if (listing) {
        listing.availableStock += order.quantity;
      }
    }

    return { success: true, order };
  }

  public getAllWholesalers(): Wholesaler[] {
    return [...this.wholesalers];
  }

  public getB2BCommissionReport(): { totalGrossVolumeETB: number; totalPlatformFeesETB: number; ordersCount: number; orders: WholesalePurchaseOrder[] } {
    const activeOrders = this.wholesalePurchaseOrders.filter((o) => o.status !== 'CANCELLED');
    const totalGrossVolumeETB = activeOrders.reduce((sum, o) => sum + o.totalPriceETB, 0);
    const totalPlatformFeesETB = activeOrders.reduce((sum, o) => sum + o.platformFeeETB, 0);
    return {
      totalGrossVolumeETB,
      totalPlatformFeesETB,
      ordersCount: activeOrders.length,
      orders: activeOrders,
    };
  }
}

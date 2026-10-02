import { UserSubscription, PaymentInvoice } from '../monetization/subscription.types';

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
  createdAt: string;
  expiresAt: string;
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

  private constructor() {
    this.seedPharmacies();
    this.seedVerificationApplications();
  }

  public static getInstance(): InMemoryDatabase {
    if (!InMemoryDatabase.instance) {
      InMemoryDatabase.instance = new InMemoryDatabase();
    }
    return InMemoryDatabase.instance;
  }

  private seedPharmacies() {
    this.pharmacies = [
      {
        id: 'pharm-bole-01',
        name: 'Kenema Pharmacy No. 12 (Bole)',
        subCity: 'Bole',
        city: 'Addis Ababa',
        latitude: 9.0015,
        longitude: 38.7845,
        phone: '+251911223344',
        telegramChatId: 'tg_kenema_bole',
        isVerified: true,
        efdaLicenseNumber: 'EFDA/PH/AA/2024/0912',
        tinNumber: 'TIN-0019283741',
        tier: 'PREMIUM',
        trustScore: 98,
        strikeCount: 0,
        isShadowBanned: false,
        isPermanentlyBanned: false,
        inStockItems: ['insulin', 'metformin', 'amoxicillin', 'augmentin', 'paracetamol'],
        inventory: [
          { name: 'Insulin (Humulin N / Regular)', genericName: 'Human Insulin', category: 'Diabetes', priceETB: 450, inStock: true, updatedAt: new Date().toISOString() },
          { name: 'Metformin 500mg / 850mg', genericName: 'Metformin', category: 'Diabetes', priceETB: 120, inStock: true, updatedAt: new Date().toISOString() },
          { name: 'Augmentin 625mg / 1g', genericName: 'Amoxicillin + Clavulanate', category: 'Antibiotics', priceETB: 390, inStock: true, updatedAt: new Date().toISOString() },
          { name: 'Paracetamol 500mg', genericName: 'Acetaminophen', category: 'Pain & Fever', priceETB: 30, inStock: true, updatedAt: new Date().toISOString() },
        ],
      },
      {
        id: 'pharm-mexico-05',
        name: 'Aster Pharmacy (Mexico Square)',
        subCity: 'Kirkos',
        city: 'Addis Ababa',
        latitude: 9.0105,
        longitude: 38.7455,
        phone: '+251955667788',
        telegramChatId: 'tg_aster_mexico',
        isVerified: true,
        efdaLicenseNumber: 'EFDA/PH/AA/2023/1402',
        tinNumber: 'TIN-0028471923',
        tier: 'PREMIUM',
        trustScore: 95,
        strikeCount: 0,
        isShadowBanned: false,
        isPermanentlyBanned: false,
        inStockItems: ['insulin', 'humulin n', 'ventolin', 'augmentin', 'ceftriaxone'],
        inventory: [
          { name: 'Insulin (Humulin N / Regular)', genericName: 'Human Insulin', category: 'Diabetes', priceETB: 420, inStock: true, updatedAt: new Date().toISOString() },
          { name: 'Ventolin Inhaler 100mcg', genericName: 'Salbutamol', category: 'Respiratory', priceETB: 310, inStock: true, updatedAt: new Date().toISOString() },
          { name: 'Ceftriaxone 1g Vial', genericName: 'Ceftriaxone', category: 'Injectables', priceETB: 180, inStock: true, updatedAt: new Date().toISOString() },
        ],
      },
      {
        id: 'pharm-megenagna-02',
        name: 'Lion Pharmacy (Megenagna Branch)',
        subCity: 'Yeka',
        city: 'Addis Ababa',
        latitude: 9.0201,
        longitude: 38.8021,
        phone: '+251922334455',
        telegramChatId: 'tg_lion_megenagna',
        isVerified: true,
        efdaLicenseNumber: 'EFDA/PH/AA/2024/0551',
        tinNumber: 'TIN-0048192341',
        tier: 'PREMIUM',
        trustScore: 92,
        strikeCount: 0,
        isShadowBanned: false,
        isPermanentlyBanned: false,
        inStockItems: ['ventolin', 'salbutamol', 'eltroxin', 'omeprazole', 'augmentin'],
        inventory: [
          { name: 'Ventolin Inhaler 100mcg', genericName: 'Salbutamol', category: 'Respiratory', priceETB: 320, inStock: true, updatedAt: new Date().toISOString() },
          { name: 'Eltroxin 50mcg / 100mcg', genericName: 'Levothyroxine', category: 'Thyroid', priceETB: 280, inStock: true, updatedAt: new Date().toISOString() },
          { name: 'Omeprazole 20mg', genericName: 'Omeprazole', category: 'Gastrointestinal', priceETB: 70, inStock: true, updatedAt: new Date().toISOString() },
        ],
      },
      {
        id: 'pharm-piazza-03',
        name: 'Buraq Modern Pharmacy (Piazza)',
        subCity: 'Arada',
        city: 'Addis Ababa',
        latitude: 9.0345,
        longitude: 38.7512,
        phone: '+251933445566',
        telegramChatId: 'tg_buraq_piazza',
        isVerified: true,
        efdaLicenseNumber: 'EFDA/PH/AA/2023/8892',
        tinNumber: 'TIN-0039281729',
        tier: 'BASIC',
        trustScore: 89,
        strikeCount: 0,
        isShadowBanned: false,
        isPermanentlyBanned: false,
        inStockItems: ['insulin', 'eltroxin', 'losartan', 'metformin', 'lipitor'],
        inventory: [
          { name: 'Insulin (Humulin N / Regular)', genericName: 'Human Insulin', category: 'Diabetes', priceETB: 440, inStock: true, updatedAt: new Date().toISOString() },
          { name: 'Losartan Potassium 50mg', genericName: 'Losartan', category: 'Hypertension', priceETB: 140, inStock: true, updatedAt: new Date().toISOString() },
          { name: 'Atorvastatin 20mg (Lipitor)', genericName: 'Atorvastatin', category: 'Cardiovascular', priceETB: 250, inStock: true, updatedAt: new Date().toISOString() },
        ],
      },
      {
        id: 'pharm-saris-04',
        name: 'Saris Community Care Pharmacy',
        subCity: 'Nifas Silk-Lafto',
        city: 'Addis Ababa',
        latitude: 8.9567,
        longitude: 38.7612,
        phone: '+251944556677',
        telegramChatId: 'tg_saris_care',
        isVerified: true,
        efdaLicenseNumber: 'EFDA/PH/AA/2024/3109',
        tinNumber: 'TIN-0091827364',
        tier: 'BASIC',
        trustScore: 90,
        strikeCount: 0,
        isShadowBanned: false,
        isPermanentlyBanned: false,
        inStockItems: ['amoxicillin', 'azithromycin', 'paracetamol', 'ibuprofen'],
        inventory: [
          { name: 'Amoxicillin 500mg', genericName: 'Amoxicillin', category: 'Antibiotics', priceETB: 85, inStock: true, updatedAt: new Date().toISOString() },
          { name: 'Azithromycin 500mg', genericName: 'Azithromycin', category: 'Antibiotics', priceETB: 220, inStock: true, updatedAt: new Date().toISOString() },
        ],
      },
      {
        id: 'pharm-kirkos-8815',
        name: 'Selam Community Pharmacy',
        subCity: 'Kirkos',
        city: 'Addis Ababa',
        latitude: 9.0105,
        longitude: 38.7455,
        phone: '+251922889900',
        telegramChatId: 'tg_user_33812',
        isVerified: true,
        efdaLicenseNumber: 'EFDA/PH/AA/2023/5021',
        tinNumber: 'TIN-0082910472',
        tier: 'PREMIUM',
        trustScore: 98,
        strikeCount: 0,
        isShadowBanned: false,
        isPermanentlyBanned: false,
        inStockItems: ['insulin', 'augmentin', 'amoxicillin', 'metformin', 'ventolin'],
        inventory: [
          { name: 'Insulin (Humulin N / Regular)', genericName: 'Human Insulin', category: 'Diabetes', priceETB: 450, inStock: true, updatedAt: new Date().toISOString() },
          { name: 'Augmentin 625mg / 1g', genericName: 'Amoxicillin + Clavulanic Acid', category: 'Antibiotics', priceETB: 380, inStock: true, updatedAt: new Date().toISOString() },
          { name: 'Metformin 500mg / 850mg', genericName: 'Metformin Hydrochloride', category: 'Diabetes', priceETB: 120, inStock: true, updatedAt: new Date().toISOString() },
          { name: 'Ventolin Inhaler 100mcg', genericName: 'Salbutamol', category: 'Respiratory', priceETB: 320, inStock: true, updatedAt: new Date().toISOString() },
        ],
      },
    ];
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
      createdAt: now.toISOString(),
      expiresAt,
    };

    this.reservations.set(randomCode, hold);
    return hold;
  }

  public verifyAndFulfillReservation(reservationCode: string): { success: boolean; message: string; reservation?: ReservationHold } {
    const hold = this.reservations.get(reservationCode);
    if (!hold) return { success: false, message: 'Reservation code not found' };

    if (new Date() > new Date(hold.expiresAt)) {
      hold.status = 'EXPIRED';
      return { success: false, message: 'This reservation hold has expired (60-minute limit exceeded)' };
    }

    hold.status = 'FULFILLED';

    // Boost pharmacy trust score slightly on honest fulfillment
    const pharmacy = this.pharmacies.find((p) => p.id === hold.pharmacyId);
    if (pharmacy && pharmacy.trustScore < 100) {
      pharmacy.trustScore = Math.min(100, pharmacy.trustScore + 1);
    }

    return {
      success: true,
      message: `Reservation #${reservationCode} verified successfully. Price locked at ${hold.lockedPriceETB} ETB.`,
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
    this.verificationApplications = [
      {
        id: 'MF-VERIFY-3297',
        telegramChatId: 'tg_user_romn116',
        telegramUsername: '@RoMn116',
        pharmacyName: 'Azeb Mesfin Pharmacy',
        subCity: 'Bole',
        addressDetails: 'Bole, Addis Ababa (Near Brass Clinic)',
        latitude: 9.0015,
        longitude: 38.7845,
        gpsLocationVerified: true,
        phone: '+251911998877',
        pharmacistName: 'Azeb Mesfin (B.Pharm)',
        pharmacistLicenseNumber: 'EPA-RPH-2023-8821',
        efdaLicenseNumber: 'EFDA/PH/AA/2024/3297',
        tinNumber: 'TIN-0083920194',
        counterPhotoUrl: '/api/telegram/media/AgACAgQAAxkBAAMVar4JCCIcXLlv1JhWQ0SePYd-FyEAAlcPaxvYU_BRoZjmQdTeWWQBAAMCAAN5AAM9BA',
        efdaDocUrl: '/api/telegram/media/AgACAgQAAxkBAAMVar4JCCIcXLlv1JhWQ0SePYd-FyEAAlcPaxvYU_BRoZjmQdTeWWQBAAMCAAN5AAM9BA',
        status: 'PENDING_REVIEW',
        adminNotes: 'Wall certificate photo uploaded via Telegram Bot. Awaiting visual document review and CoC registry matching.',
        submittedAt: new Date(Date.now() - 3600 * 1000 * 2).toISOString(),
      },
      {
        id: 'MF-VERIFY-8821',
        telegramChatId: 'tg_user_99120',
        telegramUsername: '@dr_solomon_pharma',
        pharmacyName: 'Abyssinia Health Care Pharmacy',
        subCity: 'Bole',
        addressDetails: 'Bole Medhanialem, Behind Edna Mall, Addis Ababa',
        phone: '+251911445566',
        pharmacistName: 'Solomon Tesfaye (B.Pharm)',
        pharmacistLicenseNumber: 'EPA-RPH-2023-4910',
        efdaLicenseNumber: 'EFDA/PH/AA/2024/7719',
        tinNumber: 'TIN-0071829304',
        counterPhotoUrl: 'https://images.unsplash.com/photo-1586015554060-705b6375005b?auto=format&fit=crop&w=400&q=80',
        efdaDocUrl: 'https://images.unsplash.com/photo-1589829545856-d10d557cf95f?auto=format&fit=crop&w=400&q=80',
        status: 'PENDING_REVIEW',
        adminNotes: 'Awaiting EFDA iRIS registry serial number verification.',
        submittedAt: new Date(Date.now() - 3600 * 1000 * 4).toISOString(),
      },
      {
        id: 'MF-VERIFY-8815',
        telegramChatId: 'tg_user_33812',
        telegramUsername: '@selam_pharm_kazanchis',
        pharmacyName: 'Selam Community Pharmacy',
        subCity: 'Kirkos',
        addressDetails: 'Kazanchis, Near ECA building, Addis Ababa',
        phone: '+251922889900',
        pharmacistName: 'Selamawit Bekele (Druggist)',
        pharmacistLicenseNumber: 'EPA-DRUG-2022-1092',
        efdaLicenseNumber: 'EFDA/PH/AA/2023/5021',
        tinNumber: 'TIN-0082910472',
        counterPhotoUrl: 'https://images.unsplash.com/photo-1576602976047-174e57a47881?auto=format&fit=crop&w=400&q=80',
        efdaDocUrl: 'https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?auto=format&fit=crop&w=400&q=80',
        status: 'APPROVED',
        approvedPharmacyId: 'pharm-kirkos-8815',
        adminNotes: 'Cross-checked against EFDA iRIS & MoTRI Trade portal. CoC active until Nov 2026.',
        submittedAt: new Date(Date.now() - 3600 * 1000 * 48).toISOString(),
        reviewedAt: new Date(Date.now() - 3600 * 1000 * 24).toISOString(),
      },
    ];
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
}

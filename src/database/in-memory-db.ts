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
  username: string;
  passwordHash: string;
  tempPassword?: string;
  setupToken?: string;
  setupTokenExpiresAt?: string;
  mustChangePassword: boolean;
  createdAt: string;
  lastLoginAt?: string;
  sessionToken?: string;
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

  private constructor() {
    this.seedPharmacies();
    this.seedVerificationApplications();
    this.seedDefaultAdmin();
  }

  public static getInstance(): InMemoryDatabase {
    if (!InMemoryDatabase.instance) {
      InMemoryDatabase.instance = new InMemoryDatabase();
    }
    return InMemoryDatabase.instance;
  }

  private seedPharmacies() {
    this.pharmacies = [];
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
      const portalAcc = this.createOrGetPharmacyAccount(pharmacy);
      app.portalUsername = portalAcc.username;
      app.portalTempPassword = portalAcc.tempPassword;
      app.portalSetupToken = portalAcc.setupToken;
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

  public createOrGetPharmacyAccount(pharmacy: Pharmacy): PharmacyPortalAccount {
    // Check if account already exists for this pharmacy
    for (const acc of this.pharmacyAccounts.values()) {
      if (acc.pharmacyId === pharmacy.id) return acc;
    }

    // Generate clean base username
    const cleanName = pharmacy.name
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');
    const randNum = Math.floor(100 + Math.random() * 900);
    const baseUsername = cleanName ? `${cleanName.substring(0, 15)}_${randNum}` : `pharm_${randNum}`;
    let finalUsername = baseUsername;
    let counter = 1;
    while (this.pharmacyAccounts.has(finalUsername)) {
      finalUsername = `${baseUsername}_${counter++}`;
    }

    // Generate initial temporary password (e.g. Med#8492!ET)
    const tempCode = Math.floor(1000 + Math.random() * 9000);
    const tempPassword = `Med#${tempCode}!ET`;
    const passwordHash = InMemoryDatabase.hashPassword(tempPassword);

    // Generate 24-hour setup token
    const setupToken = crypto.randomBytes(16).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const account: PharmacyPortalAccount = {
      id: `acc-${crypto.randomBytes(4).toString('hex')}`,
      pharmacyId: pharmacy.id,
      pharmacyName: pharmacy.name,
      subCity: pharmacy.subCity,
      phone: pharmacy.phone,
      username: finalUsername,
      passwordHash,
      tempPassword,
      setupToken,
      setupTokenExpiresAt: expiresAt,
      mustChangePassword: true,
      createdAt: new Date().toISOString(),
    };

    this.pharmacyAccounts.set(finalUsername, account);
    return account;
  }

  public authenticatePharmacy(username: string, password: string): { success: boolean; account?: PharmacyPortalAccount; token?: string; error?: string } {
    const acc = this.pharmacyAccounts.get(username.trim().toLowerCase());
    if (!acc) {
      return { success: false, error: 'Invalid username or password' };
    }

    const hash = InMemoryDatabase.hashPassword(password);
    if (acc.passwordHash !== hash) {
      return { success: false, error: 'Invalid username or password' };
    }

    // Generate active session token
    acc.sessionToken = 'sess_' + crypto.randomBytes(16).toString('hex');
    acc.lastLoginAt = new Date().toISOString();

    return {
      success: true,
      account: acc,
      token: acc.sessionToken,
    };
  }

  public changePharmacyPassword(username: string, currentPassword: string, newPassword: string): { success: boolean; account?: PharmacyPortalAccount; error?: string } {
    const acc = this.pharmacyAccounts.get(username.trim().toLowerCase());
    if (!acc) return { success: false, error: 'Account not found' };

    const currentHash = InMemoryDatabase.hashPassword(currentPassword);
    if (acc.passwordHash !== currentHash) {
      return { success: false, error: 'Current password incorrect' };
    }

    if (!newPassword || newPassword.length < 8) {
      return { success: false, error: 'New password must be at least 8 characters long' };
    }

    acc.passwordHash = InMemoryDatabase.hashPassword(newPassword);
    acc.mustChangePassword = false;
    delete acc.tempPassword;
    delete acc.setupToken;
    delete acc.setupTokenExpiresAt;

    return { success: true, account: acc };
  }

  public activateAccountWithToken(setupToken: string, newPassword: string, customUsername?: string): { success: boolean; account?: PharmacyPortalAccount; token?: string; error?: string } {
    let targetAcc: PharmacyPortalAccount | undefined;
    for (const acc of this.pharmacyAccounts.values()) {
      if (acc.setupToken === setupToken) {
        targetAcc = acc;
        break;
      }
    }

    if (!targetAcc) return { success: false, error: 'Invalid or expired setup token' };

    if (targetAcc.setupTokenExpiresAt && new Date(targetAcc.setupTokenExpiresAt).getTime() < Date.now()) {
      return { success: false, error: 'Setup link has expired. Please contact EFDA support or request a new link.' };
    }

    if (!newPassword || newPassword.length < 8) {
      return { success: false, error: 'Password must be at least 8 characters long' };
    }

    if (customUsername && customUsername.trim().length >= 3) {
      const cleanCustom = customUsername.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
      if (cleanCustom !== targetAcc.username) {
        if (this.pharmacyAccounts.has(cleanCustom)) {
          return { success: false, error: 'Chosen username is already taken. Please choose another.' };
        }
        this.pharmacyAccounts.delete(targetAcc.username);
        targetAcc.username = cleanCustom;
        this.pharmacyAccounts.set(cleanCustom, targetAcc);
      }
    }

    targetAcc.passwordHash = InMemoryDatabase.hashPassword(newPassword);
    targetAcc.mustChangePassword = false;
    delete targetAcc.tempPassword;
    delete targetAcc.setupToken;
    delete targetAcc.setupTokenExpiresAt;
    targetAcc.sessionToken = 'sess_' + crypto.randomBytes(16).toString('hex');
    targetAcc.lastLoginAt = new Date().toISOString();

    return { success: true, account: targetAcc, token: targetAcc.sessionToken };
  }

  public getAccountBySession(token: string): PharmacyPortalAccount | undefined {
    if (!token) return undefined;
    for (const acc of this.pharmacyAccounts.values()) {
      if (acc.sessionToken === token) return acc;
    }
    return undefined;
  }

  public getAccountBySetupToken(setupToken: string): PharmacyPortalAccount | undefined {
    if (!setupToken) return undefined;
    for (const acc of this.pharmacyAccounts.values()) {
      if (acc.setupToken === setupToken) return acc;
    }
    return undefined;
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
}

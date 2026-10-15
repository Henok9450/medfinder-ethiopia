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
  sessionExpiresAt?: string; // Strict short-lived admin session expiry (30 mins)
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
  openingTime?: string; // '08:00' (HH:mm in EAT)
  closingTime?: string; // '21:30' (HH:mm in EAT)
  is24Hours?: boolean; // Emergency 24/7 night duty service
  isManuallyClosed?: boolean; // Manual 1-tap counter pause / off-duty toggle
  lastHeartbeatAt?: string; // Real-time counter terminal telemetry
}

export interface PharmacyOperatingStatus {
  isOpen: boolean;
  statusLabel: 'OPEN' | 'CLOSED' | 'NIGHT_DUTY_24H' | 'ON_BREAK';
  badgeText: string;
  badgeColor: 'emerald' | 'rose' | 'amber' | 'indigo';
  openingTime: string;
  closingTime: string;
  is24Hours: boolean;
  isManuallyClosed: boolean;
  minutesRemainingUntilClose: number | null;
  opensAtMessage?: string;
  closesAtMessage?: string;
  canAcceptHold: boolean;
  maxHoldMinutes: number;
  reason?: string;
}

export function evaluatePharmacyOperatingStatus(pharmacy: Pharmacy, now = new Date()): PharmacyOperatingStatus {
  const openingTime = pharmacy.openingTime || '08:00';
  const closingTime = pharmacy.closingTime || '21:30';
  const is24Hours = Boolean(pharmacy.is24Hours);
  const isManuallyClosed = Boolean(pharmacy.isManuallyClosed);

  if (pharmacy.isPermanentlyBanned) {
    return {
      isOpen: false,
      statusLabel: 'CLOSED',
      badgeText: 'Permanently Banned / የታገደ',
      badgeColor: 'rose',
      openingTime,
      closingTime,
      is24Hours: false,
      isManuallyClosed: true,
      minutesRemainingUntilClose: 0,
      canAcceptHold: false,
      maxHoldMinutes: 0,
      reason: 'PERMANENTLY_BANNED',
    };
  }

  if (isManuallyClosed) {
    return {
      isOpen: false,
      statusLabel: 'ON_BREAK',
      badgeText: 'Counter Closed (በጊዜያዊነት ዝግ ነው)',
      badgeColor: 'amber',
      openingTime,
      closingTime,
      is24Hours,
      isManuallyClosed: true,
      minutesRemainingUntilClose: 0,
      opensAtMessage: 'Counter temporarily on pause / break.',
      canAcceptHold: false,
      maxHoldMinutes: 0,
      reason: 'MANUALLY_CLOSED',
    };
  }

  if (is24Hours) {
    return {
      isOpen: true,
      statusLabel: 'NIGHT_DUTY_24H',
      badgeText: '🌙 24/7 Night Duty (የሌሊት ፈረቃ)',
      badgeColor: 'indigo',
      openingTime: '00:00',
      closingTime: '23:59',
      is24Hours: true,
      isManuallyClosed: false,
      minutesRemainingUntilClose: null,
      closesAtMessage: 'Open 24/7 Emergency Service',
      canAcceptHold: true,
      maxHoldMinutes: 60,
    };
  }

  // Convert to East Africa Time (EAT = UTC+3)
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  const eatDate = new Date(utcMs + 3 * 3600000);
  const currentHours = eatDate.getHours();
  const currentMinutes = eatDate.getMinutes();
  const currentTotalMinutes = currentHours * 60 + currentMinutes;

  const [openH, openM] = openingTime.split(':').map(Number);
  const [closeH, closeM] = closingTime.split(':').map(Number);
  const openTotalMinutes = (isNaN(openH) ? 8 : openH) * 60 + (isNaN(openM) ? 0 : openM);
  const closeTotalMinutes = (isNaN(closeH) ? 21 : closeH) * 60 + (isNaN(closeM) ? 30 : closeM);

  const isOvernight = closeTotalMinutes < openTotalMinutes;
  const isOpen = isOvernight
    ? (currentTotalMinutes >= openTotalMinutes || currentTotalMinutes < closeTotalMinutes)
    : (currentTotalMinutes >= openTotalMinutes && currentTotalMinutes < closeTotalMinutes);

  if (isOpen) {
    let minutesRemaining: number;
    if (isOvernight) {
      if (currentTotalMinutes >= openTotalMinutes) {
        minutesRemaining = (1440 - currentTotalMinutes) + closeTotalMinutes;
      } else {
        minutesRemaining = closeTotalMinutes - currentTotalMinutes;
      }
    } else {
      minutesRemaining = closeTotalMinutes - currentTotalMinutes;
    }

    const maxHold = Math.min(60, Math.max(5, minutesRemaining));
    const closeTimeStr = `${String(closeH).padStart(2, '0')}:${String(closeM).padStart(2, '0')}`;

    return {
      isOpen: true,
      statusLabel: 'OPEN',
      badgeText: minutesRemaining <= 30
        ? `⚠️ Closes in ${minutesRemaining}m (${closeTimeStr})`
        : `🟢 Open until ${closeTimeStr}`,
      badgeColor: minutesRemaining <= 30 ? 'amber' : 'emerald',
      openingTime,
      closingTime,
      is24Hours: false,
      isManuallyClosed: false,
      minutesRemainingUntilClose: minutesRemaining,
      closesAtMessage: `Closes at ${closeTimeStr} EAT`,
      canAcceptHold: true,
      maxHoldMinutes: maxHold,
    };
  } else {
    const openTimeStr = `${String(openH).padStart(2, '0')}:${String(openM).padStart(2, '0')}`;
    return {
      isOpen: false,
      statusLabel: 'CLOSED',
      badgeText: `🔴 Closed (Opens ${openTimeStr})`,
      badgeColor: 'rose',
      openingTime,
      closingTime,
      is24Hours: false,
      isManuallyClosed: false,
      minutesRemainingUntilClose: 0,
      opensAtMessage: `Opens at ${openTimeStr} EAT`,
      canAcceptHold: false,
      maxHoldMinutes: 0,
      reason: 'AFTER_HOURS',
    };
  }
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
  accessKey?: string;           // 1-Click access key (e.g. mf_ws_cadila_7718)
  sessionToken?: string;        // 180-day persistent session token
  sessionExpiresAt?: string;    // Session expiry ISO timestamp
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
  patientPhone?: string;
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
  fulfilledAt?: string;
  cancelledAt?: string;
  cancelledBy?: 'PATIENT' | 'PHARMACIST' | 'SYSTEM_TIMEOUT';
  reason?: string;
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
  step: 'START' | 'LANGUAGE' | 'PHARMACY_NAME' | 'LOCATION_GPS' | 'PHONE' | 'PHARMACIST_INFO' | 'EFDA_LICENSE' | 'LICENSE_PHOTO' | 'TIN_NUMBER' | 'COUNTER_PHOTO' | 'CONFIRM' | 'AWAITING_INFO_UPDATE' | 'PATIENT_SEARCH' | 'AWAITING_SEARCH_LOCATION' | 'PATIENT_HOLD_PHONE_VERIFY';
  mode?: 'PATIENT' | 'PHARMACY';
  patientSearchDrug?: string;
  patientLat?: number;
  patientLng?: number;
  patientSubCity?: string;
  updatingApplicationId?: string;
  verifiedPhoneNumber?: string;
  pendingHoldPharmacyId?: string;
  pendingHoldDrug?: string;
  pendingAuthToken?: string;
  data: Partial<PharmacyVerificationApplication>;
  language: 'am' | 'en';
}

export interface PatientAuthSession {
  token: string;
  createdAt: string;
  expiresAt: string;
  status: 'PENDING' | 'VERIFIED' | 'EXPIRED';
  verifiedPhone?: string;
  telegramUserId?: string;
  telegramUsername?: string;
  verifiedAt?: string;
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
  public patientAuthSessions: Map<string, PatientAuthSession> = new Map();

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
    const pBole: Pharmacy = {
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
      inStockItems: ['ventolin inhaler 100mcg', 'amoxicillin 500mg', 'augmentin 625mg', 'insulin', 'metformin 500mg'],
      inventory: [
        { name: 'Ventolin Inhaler 100mcg', genericName: 'Salbutamol', category: 'Respiratory', priceETB: 550, inStock: true, updatedAt: new Date().toISOString() },
        { name: 'Amoxicillin 500mg', genericName: 'Amoxicillin', category: 'Antibiotics', priceETB: 220, inStock: true, updatedAt: new Date().toISOString() },
        { name: 'Augmentin 625mg', genericName: 'Amoxicillin + Clavulanate', category: 'Antibiotics', priceETB: 410, inStock: true, updatedAt: new Date().toISOString() },
        { name: 'Insulin (Humulin N)', genericName: 'Human Insulin', category: 'Diabetes', priceETB: 480, inStock: true, updatedAt: new Date().toISOString() },
        { name: 'Metformin 500mg', genericName: 'Metformin Hydrochloride', category: 'Diabetes', priceETB: 120, inStock: true, updatedAt: new Date().toISOString() },
      ],
      analyticsAccess: { enabled: true, tier: 'PRO', allowedSubCities: ['Bole'] },
    };

    const pLemiKura: Pharmacy = {
      id: 'pharm-lemikura-4102',
      name: 'Ayat Care Pharmacy & Diagnostics',
      subCity: 'Lemi Kura',
      city: 'Addis Ababa',
      phone: '0911556677',
      telegramChatId: 'tg_user_44120',
      latitude: 9.0180,
      longitude: 38.8450,
      address: 'Ayat Zone 3, Near LRT Terminal & Summit Junction',
      isVerified: true,
      efdaLicenseNumber: 'EFDA/PH/AA/2024/4102',
      tinNumber: 'TIN-0091223344',
      tier: 'PREMIUM',
      trustScore: 99,
      strikeCount: 0,
      isShadowBanned: false,
      isPermanentlyBanned: false,
      inStockItems: ['ventolin inhaler 100mcg', 'augmentin 625mg', 'amoxicillin 500mg', 'coartem', 'paracetamol 500mg'],
      inventory: [
        { name: 'Ventolin Inhaler 100mcg', genericName: 'Salbutamol', category: 'Respiratory', priceETB: 530, inStock: true, updatedAt: new Date().toISOString() },
        { name: 'Augmentin 625mg', genericName: 'Amoxicillin + Clavulanate', category: 'Antibiotics', priceETB: 395, inStock: true, updatedAt: new Date().toISOString() },
        { name: 'Amoxicillin 500mg', genericName: 'Amoxicillin', category: 'Antibiotics', priceETB: 210, inStock: true, updatedAt: new Date().toISOString() },
        { name: 'Coartem 20/120', genericName: 'Artemether + Lumefantrine', category: 'Antimalarial', priceETB: 160, inStock: true, updatedAt: new Date().toISOString() },
        { name: 'Paracetamol 500mg', genericName: 'Paracetamol', category: 'Pain & Fever', priceETB: 30, inStock: true, updatedAt: new Date().toISOString() },
      ],
      analyticsAccess: { enabled: true, tier: 'PRO', allowedSubCities: ['Lemi Kura'] },
    };

    const pYeka: Pharmacy = {
      id: 'pharm-yeka-5510',
      name: 'Megenagna Central Pharmacy',
      subCity: 'Yeka',
      city: 'Addis Ababa',
      phone: '0911889900',
      telegramChatId: 'tg_user_55100',
      latitude: 9.0280,
      longitude: 38.8020,
      address: 'Megenagna Roundabout, Next to Zefmesh Grand Mall',
      isVerified: true,
      efdaLicenseNumber: 'EFDA/PH/AA/2024/5510',
      tinNumber: 'TIN-0078129034',
      tier: 'BASIC',
      trustScore: 96,
      strikeCount: 0,
      isShadowBanned: false,
      isPermanentlyBanned: false,
      inStockItems: ['ventolin inhaler 100mcg', 'insulin', 'eltroxin 100mcg', 'augmentin 625mg'],
      inventory: [
        { name: 'Ventolin Inhaler 100mcg', genericName: 'Salbutamol', category: 'Respiratory', priceETB: 560, inStock: true, updatedAt: new Date().toISOString() },
        { name: 'Insulin (Humulin N)', genericName: 'Human Insulin', category: 'Diabetes', priceETB: 470, inStock: true, updatedAt: new Date().toISOString() },
        { name: 'Eltroxin 100mcg', genericName: 'Levothyroxine', category: 'Thyroid', priceETB: 290, inStock: true, updatedAt: new Date().toISOString() },
        { name: 'Augmentin 625mg', genericName: 'Amoxicillin + Clavulanate', category: 'Antibiotics', priceETB: 415, inStock: true, updatedAt: new Date().toISOString() },
      ],
      analyticsAccess: { enabled: true, tier: 'BASIC', allowedSubCities: ['Yeka'] },
    };

    const pKirkos: Pharmacy = {
      id: 'pharm-kirkos-1120',
      name: 'Mexico Square Community Pharmacy',
      subCity: 'Kirkos',
      city: 'Addis Ababa',
      phone: '0922334455',
      telegramChatId: 'tg_user_11200',
      latitude: 9.0110,
      longitude: 38.7520,
      address: 'Mexico Sq, Opposite Kiamed Medical College',
      isVerified: true,
      efdaLicenseNumber: 'EFDA/PH/AA/2024/1120',
      tinNumber: 'TIN-0065432190',
      tier: 'PREMIUM',
      trustScore: 97,
      strikeCount: 0,
      isShadowBanned: false,
      isPermanentlyBanned: false,
      inStockItems: ['metformin 500mg', 'amlodipine 10mg', 'losartan 50mg', 'amoxicillin 500mg'],
      inventory: [
        { name: 'Metformin 500mg', genericName: 'Metformin Hydrochloride', category: 'Diabetes', priceETB: 115, inStock: true, updatedAt: new Date().toISOString() },
        { name: 'Amlodipine 10mg', genericName: 'Amlodipine', category: 'Hypertension', priceETB: 110, inStock: true, updatedAt: new Date().toISOString() },
        { name: 'Losartan Potassium 50mg', genericName: 'Losartan', category: 'Hypertension', priceETB: 145, inStock: true, updatedAt: new Date().toISOString() },
        { name: 'Amoxicillin 500mg', genericName: 'Amoxicillin', category: 'Antibiotics', priceETB: 215, inStock: true, updatedAt: new Date().toISOString() },
      ],
      analyticsAccess: { enabled: true, tier: 'BASIC', allowedSubCities: ['Kirkos'] },
    };

    const pAddisKetema: Pharmacy = {
      id: 'pharm-addisketema-2290',
      name: 'Merkato Commercial Pharmacy',
      subCity: 'Addis Ketema',
      city: 'Addis Ababa',
      phone: '0933445566',
      telegramChatId: 'tg_user_22900',
      latitude: 9.0320,
      longitude: 38.7350,
      address: 'Autobis Tera, Merkato Commercial Center',
      isVerified: true,
      efdaLicenseNumber: 'EFDA/PH/AA/2024/2290',
      tinNumber: 'TIN-0054321098',
      tier: 'BASIC',
      trustScore: 95,
      strikeCount: 0,
      isShadowBanned: false,
      isPermanentlyBanned: false,
      inStockItems: ['amoxicillin 500mg', 'paracetamol 500mg', 'coartem', 'ceftriaxone 1g'],
      inventory: [
        { name: 'Amoxicillin 500mg', genericName: 'Amoxicillin', category: 'Antibiotics', priceETB: 200, inStock: true, updatedAt: new Date().toISOString() },
        { name: 'Paracetamol 500mg', genericName: 'Paracetamol', category: 'Pain & Fever', priceETB: 28, inStock: true, updatedAt: new Date().toISOString() },
        { name: 'Coartem 20/120', genericName: 'Artemether + Lumefantrine', category: 'Antimalarial', priceETB: 155, inStock: true, updatedAt: new Date().toISOString() },
        { name: 'Ceftriaxone 1g Vial', genericName: 'Ceftriaxone', category: 'Injectables', priceETB: 185, inStock: true, updatedAt: new Date().toISOString() },
      ],
      analyticsAccess: { enabled: true, tier: 'BASIC', allowedSubCities: ['Addis Ketema'] },
    };

    this.pharmacies = [pBole, pLemiKura, pYeka, pKirkos, pAddisKetema];
    for (const ph of this.pharmacies) {
      this.createOrGetPharmacyAccount(ph, ph.telegramChatId);
    }
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

  // --- ANTI-SCAM 1-HOUR PRICE-LOCK RESERVATION ENGINE & HOLD FAIRNESS ---

  public getActiveHoldForPatient(patientUserId: string, patientPhone?: string): ReservationHold | null {
    const now = new Date();
    const cleanPhone = patientPhone ? patientPhone.replace(/[^0-9]/g, '') : '';

    for (const r of this.reservations.values()) {
      if (r.status === 'ACTIVE' && now < new Date(r.expiresAt)) {
        if (r.patientUserId === patientUserId) return r;
        if (cleanPhone && r.patientPhone) {
          const rPhone = r.patientPhone.replace(/[^0-9]/g, '');
          if (rPhone && (rPhone === cleanPhone || rPhone.endsWith(cleanPhone) || cleanPhone.endsWith(rPhone))) {
            return r;
          }
        }
      }
    }
    return null;
  }

  public checkPatientHoldEligibility(patientUserId: string, patientPhone?: string): {
    eligible: boolean;
    reason?: 'ACTIVE_HOLD_EXISTS' | 'NO_SHOW_PENALTY' | 'BANNED';
    activeHold?: ReservationHold;
    cooldownUntil?: string;
    message: string;
    messageAm: string;
  } {
    const now = new Date();

    // 1. Max 1 Active Hold Safeguard: Prevents phantom locking across multiple pharmacies
    const activeHold = this.getActiveHoldForPatient(patientUserId, patientPhone);
    if (activeHold) {
      return {
        eligible: false,
        reason: 'ACTIVE_HOLD_EXISTS',
        activeHold,
        message: `You already have an active hold (#${activeHold.reservationCode}) for "${activeHold.medicineName}" at ${activeHold.pharmacyName}. Please collect or cancel your active voucher before reserving another item.`,
        messageAm: `እርስዎ ቀደም ሲል የያዙት ንቁ ማቆያ (#${activeHold.reservationCode} - "${activeHold.medicineName}") በ${activeHold.pharmacyName} አለዎት። እባክዎ አዲሱን ከማስያዝዎ በፊት ያንን ይውሰዱ ወይም ይሰርዙ።`,
      };
    }

    // 2. No-Show Penalty Rule: If patient has >= 3 uncollected/expired holds in last 7 days with zero fulfillments
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const cleanPhone = patientPhone ? patientPhone.replace(/[^0-9]/g, '') : '';
    let expiredStrikes = 0;
    let fulfilledCount = 0;
    let latestExpiredAt: Date | null = null;

    for (const r of this.reservations.values()) {
      const isMatch = r.patientUserId === patientUserId || 
        (cleanPhone && r.patientPhone && r.patientPhone.replace(/[^0-9]/g, '').endsWith(cleanPhone));
      if (!isMatch) continue;

      const created = new Date(r.createdAt);
      if (created < sevenDaysAgo) continue;

      if (r.status === 'FULFILLED') {
        fulfilledCount++;
      } else if (r.status === 'EXPIRED' || (r.status === 'ACTIVE' && now > new Date(r.expiresAt))) {
        expiredStrikes++;
        const expDate = new Date(r.expiresAt);
        if (!latestExpiredAt || expDate > latestExpiredAt) {
          latestExpiredAt = expDate;
        }
      }
    }

    if (expiredStrikes >= 3 && fulfilledCount === 0 && latestExpiredAt) {
      const cooldownEnd = new Date(latestExpiredAt.getTime() + 24 * 60 * 60 * 1000);
      if (now < cooldownEnd) {
        const remainingHours = Math.max(1, Math.ceil((cooldownEnd.getTime() - now.getTime()) / (60 * 60 * 1000)));
        return {
          eligible: false,
          reason: 'NO_SHOW_PENALTY',
          cooldownUntil: cooldownEnd.toISOString(),
          message: `Hold privilege paused for ${remainingHours}h due to 3 consecutive uncollected reservations. Please purchase directly at the counter.`,
          messageAm: `በተከታታይ 3 ጊዜ ማቆያዎችን ባለመውሰድዎ ምክንያት ለ${remainingHours} ሰዓት አዲስ ማቆያ መያዝ አይችሉም። እባክዎ በቀጥታ ፋርማሲው ድረስ ሄደው ይግዙ።`,
        };
      }
    }

    return {
      eligible: true,
      message: 'Eligible to place medicine hold',
      messageAm: 'ማቆያ ለማስያዝ ብቁ ናቸው',
    };
  }

  public createReservationHold(params: {
    patientUserId: string;
    pharmacyId: string;
    medicineName: string;
    lockedPriceETB: number;
    durationMinutes?: number;
    patientPhone?: string;
  }): ReservationHold | null {
    const pharmacy = this.pharmacies.find((p) => p.id === params.pharmacyId);
    if (!pharmacy || pharmacy.isPermanentlyBanned) return null;

    // Hold Fairness Rule: Check eligibility
    const eligibility = this.checkPatientHoldEligibility(params.patientUserId, params.patientPhone);
    if (!eligibility.eligible) {
      console.warn(`[HoldFairness] Patient ${params.patientUserId} blocked from hold: ${eligibility.reason}`);
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
      patientPhone: params.patientPhone,
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

  public cancelReservationHold(params: {
    reservationCode: string;
    cancelledBy: 'PATIENT' | 'PHARMACIST' | 'SYSTEM_TIMEOUT';
    reason?: string;
  }): { success: boolean; message: string; reservation?: ReservationHold } {
    const cleanCode = params.reservationCode.trim().replace(/^#/, '');
    const hold = this.getReservationHold(cleanCode);
    if (!hold) return { success: false, message: 'Reservation code not found' };

    if (hold.status === 'FULFILLED') {
      return { success: false, message: 'Cannot cancel an already fulfilled transaction' };
    }

    hold.status = 'CANCELLED';
    hold.cancelledBy = params.cancelledBy;
    hold.cancelledAt = new Date().toISOString();
    hold.reason = params.reason || (params.cancelledBy === 'PATIENT' ? 'Cancelled by patient' : 'Cancelled by pharmacy');

    return {
      success: true,
      message: `Reservation #${cleanCode} has been cancelled successfully.`,
      reservation: hold,
    };
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
    hold.reason = reason || 'Reservation cancelled by pharmacist (Out of stock / Sold out).';
    hold.cancelledAt = new Date().toISOString();
    return { success: true, message: hold.reason, reservation: hold };
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
    hold.fulfilledAt = new Date().toISOString();

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

  public getPharmacyReservationHistory(
    pharmacyId: string,
    options?: { limit?: number; status?: string }
  ): {
    reservations: ReservationHold[];
    metrics: {
      totalReceived: number;
      fulfilledCount: number;
      fulfilledRevenueETB: number;
      cancelledCount: number;
      expiredCount: number;
      activeCount: number;
      conversionRate: number;
      missedDemand: { medicineName: string; count: number; lostRevenueETB: number }[];
    };
  } {
    const allForPharmacy: ReservationHold[] = [];
    const missedMap = new Map<string, { count: number; lostRevenueETB: number }>();
    const now = new Date();

    for (const r of this.reservations.values()) {
      if (r.pharmacyId === pharmacyId) {
        // Dynamically mark expired if active past expiresAt
        if (r.status === 'ACTIVE' && now > new Date(r.expiresAt)) {
          r.status = 'EXPIRED';
        }
        allForPharmacy.push(r);

        if (r.status === 'CANCELLED') {
          const prev = missedMap.get(r.medicineName) || { count: 0, lostRevenueETB: 0 };
          prev.count += 1;
          prev.lostRevenueETB += (r.lockedPriceETB || 0);
          missedMap.set(r.medicineName, prev);
        }
      }
    }

    // Sort newest first
    allForPharmacy.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    let fulfilledCount = 0;
    let fulfilledRevenueETB = 0;
    let cancelledCount = 0;
    let expiredCount = 0;
    let activeCount = 0;

    for (const r of allForPharmacy) {
      if (r.status === 'FULFILLED') {
        fulfilledCount++;
        fulfilledRevenueETB += (r.lockedPriceETB || 0);
      } else if (r.status === 'CANCELLED') {
        cancelledCount++;
      } else if (r.status === 'EXPIRED') {
        expiredCount++;
      } else if (r.status === 'ACTIVE') {
        activeCount++;
      }
    }

    const totalReceived = allForPharmacy.length;
    const conversionRate = totalReceived > 0 ? Math.round((fulfilledCount / totalReceived) * 100) : 0;

    const missedDemand = Array.from(missedMap.entries())
      .map(([medicineName, val]) => ({ medicineName, count: val.count, lostRevenueETB: val.lostRevenueETB }))
      .sort((a, b) => b.count - a.count);

    let filtered = allForPharmacy;
    if (options?.status && options.status !== 'ALL') {
      filtered = filtered.filter(r => r.status === options.status);
    }
    const limit = options?.limit || 100;
    filtered = filtered.slice(0, limit);

    return {
      reservations: filtered,
      metrics: {
        totalReceived,
        fulfilledCount,
        fulfilledRevenueETB,
        cancelledCount,
        expiredCount,
        activeCount,
        conversionRate,
        missedDemand
      }
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

  public createPatientAuthSession(): PatientAuthSession {
    const rawToken = 'AUTH_' + Math.random().toString(36).substring(2, 8).toUpperCase();
    const now = new Date();
    const session: PatientAuthSession = {
      token: rawToken,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 10 * 60 * 1000).toISOString(),
      status: 'PENDING',
    };
    this.patientAuthSessions.set(rawToken, session);
    return session;
  }

  public getPatientAuthSession(token: string): PatientAuthSession | undefined {
    let cleanToken = token.trim().toUpperCase();
    let s = this.patientAuthSessions.get(cleanToken);
    if (!s && !cleanToken.startsWith('AUTH_')) {
      s = this.patientAuthSessions.get('AUTH_' + cleanToken);
    }
    if (!s && cleanToken.startsWith('AUTH_')) {
      s = this.patientAuthSessions.get(cleanToken.replace(/^AUTH_/, ''));
    }
    if (!s) return undefined;
    if (s.status === 'PENDING' && new Date() > new Date(s.expiresAt)) {
      s.status = 'EXPIRED';
    }
    return s;
  }

  public verifyPatientAuthSession(token: string, phone: string, telegramUserId?: string, telegramUsername?: string): boolean {
    const s = this.getPatientAuthSession(token);
    if (!s || s.status === 'EXPIRED') return false;
    s.status = 'VERIFIED';
    s.verifiedPhone = phone.trim();
    s.telegramUserId = telegramUserId;
    s.telegramUsername = telegramUsername;
    s.verifiedAt = new Date().toISOString();
    return true;
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

  public updatePharmacyOperatingStatus(
    pharmacyId: string,
    status: {
      isManuallyClosed?: boolean;
      openingTime?: string;
      closingTime?: string;
      is24Hours?: boolean;
    }
  ): { success: boolean; pharmacy?: Pharmacy; error?: string } {
    const pharmacy = this.pharmacies.find((p) => p.id === pharmacyId);
    if (!pharmacy) return { success: false, error: 'Pharmacy not found' };

    if (status.isManuallyClosed !== undefined) pharmacy.isManuallyClosed = Boolean(status.isManuallyClosed);
    if (status.openingTime !== undefined) pharmacy.openingTime = String(status.openingTime);
    if (status.closingTime !== undefined) pharmacy.closingTime = String(status.closingTime);
    if (status.is24Hours !== undefined) pharmacy.is24Hours = Boolean(status.is24Hours);

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
    // Check if account already exists for this pharmacy or telegramChatId
    for (const acc of this.pharmacyAccounts.values()) {
      if (acc.pharmacyId === pharmacy.id || (telegramChatId && acc.telegramChatId === telegramChatId)) {
        if (telegramChatId && !acc.telegramChatId) {
          acc.telegramChatId = telegramChatId;
        }
        if (!acc.accessKey) {
          acc.accessKey = 'mf_key_' + crypto.randomBytes(24).toString('hex');
        }
        this.pharmacyAccounts.set(pharmacy.id, acc);
        this.pharmacyAccounts.set(acc.accessKey, acc);
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
      if (acc.accessKey === cleanKey || acc.setupToken === cleanKey || acc.username === cleanKey) {
        targetAcc = acc;
        break;
      }
    }

    // Self-healing fallback: Check verificationApplications
    if (!targetAcc) {
      const matchedApp = this.verificationApplications.find(
        (a) => a.portalAccessKey === cleanKey || a.portalSetupToken === cleanKey || a.portalUsername === cleanKey
      );
      if (matchedApp) {
        let pharm = this.pharmacies.find((p) => p.id === matchedApp.approvedPharmacyId);
        if (!pharm) {
          pharm = this.pharmacies.find((p) => p.efdaLicenseNumber === matchedApp.efdaLicenseNumber);
        }
        if (pharm) {
          targetAcc = this.createOrGetPharmacyAccount(pharm, matchedApp.telegramChatId);
          targetAcc.accessKey = cleanKey;
          this.pharmacyAccounts.set(cleanKey, targetAcc);
        }
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
      if (acc.pharmacyId === pharmacyId) {
        if (!acc.accessKey) {
          acc.accessKey = 'mf_key_' + crypto.randomBytes(24).toString('hex');
          this.pharmacyAccounts.set(acc.accessKey, acc);
        }
        return acc;
      }
    }
    return undefined;
  }

  public getAccountByTelegramChatId(chatId: string): PharmacyPortalAccount | undefined {
    if (!chatId) return undefined;
    for (const acc of this.pharmacyAccounts.values()) {
      if (acc.telegramChatId === chatId) {
        if (!acc.accessKey) {
          acc.accessKey = 'mf_key_' + crypto.randomBytes(24).toString('hex');
          this.pharmacyAccounts.set(acc.accessKey, acc);
        }
        return acc;
      }
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

  public authenticateAdmin(username: string, password: string): { success: boolean; admin?: Omit<AdminUser, 'passwordHash'>; token?: string; sessionExpiresAt?: string; error?: string } {
    const user = this.adminUsers.get(username.trim().toLowerCase());
    if (!user) {
      return { success: false, error: 'Invalid administrator credentials' };
    }

    const hash = InMemoryDatabase.hashPassword(password);
    if (user.passwordHash !== hash) {
      return { success: false, error: 'Invalid administrator credentials' };
    }

    // Strict 30-minute short session expiry for administrators
    const sessionExpiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    user.sessionToken = 'adm_sess_' + crypto.randomBytes(16).toString('hex');
    user.sessionExpiresAt = sessionExpiresAt;
    user.lastLoginAt = new Date().toISOString();

    const { passwordHash, ...safeAdmin } = user;
    return {
      success: true,
      admin: safeAdmin,
      token: user.sessionToken,
      sessionExpiresAt,
    };
  }

  public getAdminBySession(token: string): AdminUser | undefined {
    if (!token) return undefined;
    for (const adm of this.adminUsers.values()) {
      if (adm.sessionToken === token) {
        // Enforce short-lived expiration (30 minutes)
        if (adm.sessionExpiresAt && new Date(adm.sessionExpiresAt).getTime() < Date.now()) {
          adm.sessionToken = undefined;
          adm.sessionExpiresAt = undefined;
          return undefined; // Session expired
        }
        return adm;
      }
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
        accessKey: 'mf_ws_cadila_7718',
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
        accessKey: 'mf_ws_medtech_8842',
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
        accessKey: 'mf_ws_epharm_5531',
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

  public getWholesalerById(id: string): Wholesaler | undefined {
    return this.wholesalers.find((w) => w.id === id);
  }

  public getWholesalerByAccessKey(accessKey: string): Wholesaler | undefined {
    const cleanKey = String(accessKey).trim();
    return this.wholesalers.find((w) => w.accessKey === cleanKey || w.id === cleanKey);
  }

  public getWholesalerBySession(token: string): Wholesaler | undefined {
    const cleanToken = String(token).trim();
    const ws = this.wholesalers.find((w) => w.sessionToken === cleanToken);
    if (!ws) return undefined;
    if (ws.sessionExpiresAt && new Date(ws.sessionExpiresAt) < new Date()) {
      ws.sessionToken = undefined;
      return undefined;
    }
    return ws;
  }

  public loginWholesalerWithKey(accessKey: string): { success: boolean; wholesaler?: Wholesaler; token?: string; sessionExpiresAt?: string; error?: string } {
    const ws = this.getWholesalerByAccessKey(accessKey);
    if (!ws) {
      return { success: false, error: 'Invalid or unrecognized Wholesaler Access Key. Contact EFDA Compliance Desk.' };
    }

    const token = 'ws_sess_' + crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString();
    ws.sessionToken = token;
    ws.sessionExpiresAt = expiresAt;

    return {
      success: true,
      wholesaler: ws,
      token,
      sessionExpiresAt: expiresAt,
    };
  }

  public addWholesaleListing(listingData: Omit<WholesaleListing, 'id' | 'updatedAt'>): WholesaleListing {
    const newId = `b2b_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const now = new Date().toISOString();
    const listing: WholesaleListing = {
      ...listingData,
      id: newId,
      updatedAt: now,
    };
    this.wholesaleListings.unshift(listing);
    return listing;
  }

  public bulkImportWholesaleListings(wholesalerId: string, items: Array<Partial<WholesaleListing>>): number {
    const ws = this.getWholesalerById(wholesalerId);
    if (!ws) return 0;

    const now = new Date().toISOString();
    let count = 0;
    for (const item of items) {
      if (!item.drugName) continue;
      const listing: WholesaleListing = {
        id: `b2b_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
        wholesalerId: ws.id,
        wholesalerName: ws.name,
        wholesalerPhone: ws.phone,
        wholesalerSubCity: ws.subCity,
        drugName: String(item.drugName).trim(),
        genericName: item.genericName ? String(item.genericName).trim() : undefined,
        category: item.category ? String(item.category).trim() : 'General Prescription',
        wholesalePriceETB: Number(item.wholesalePriceETB) || 100,
        retailMspETB: item.retailMspETB ? Number(item.retailMspETB) : undefined,
        minimumOrderQty: Number(item.minimumOrderQty) || 5,
        availableStock: Number(item.availableStock) || 50,
        batchNumber: item.batchNumber ? String(item.batchNumber).trim() : `BATCH-${Math.floor(Math.random() * 8999 + 1000)}`,
        expiryDate: item.expiryDate ? String(item.expiryDate).trim() : '2027-12-31',
        efdaRegistrationNo: item.efdaRegistrationNo ? String(item.efdaRegistrationNo).trim() : ws.efdaWholesaleLicense,
        originCountry: item.originCountry ? String(item.originCountry).trim() : 'Ethiopia',
        deliveryEstimateHours: item.deliveryEstimateHours ? Number(item.deliveryEstimateHours) : 4,
        isActive: true,
        updatedAt: now,
      };
      this.wholesaleListings.unshift(listing);
      count++;
    }
    return count;
  }

  public toggleWholesaleListing(listingId: string): WholesaleListing | null {
    const listing = this.wholesaleListings.find((l) => l.id === listingId);
    if (!listing) return null;
    listing.isActive = !listing.isActive;
    listing.updatedAt = new Date().toISOString();
    return listing;
  }

  public deleteWholesaleListing(listingId: string): boolean {
    const idx = this.wholesaleListings.findIndex((l) => l.id === listingId);
    if (idx === -1) return false;
    this.wholesaleListings.splice(idx, 1);
    return true;
  }

  public getAllWholesalers(): Wholesaler[] {
    return [...this.wholesalers];
  }

  public registerWholesaler(data: {
    name: string;
    subCity: string;
    city?: string;
    phone: string;
    efdaWholesaleLicense: string;
    tinNumber?: string;
    deliveryTerms?: string;
    minimumOrderValueETB?: number;
  }): { success: boolean; wholesaler?: Wholesaler; error?: string } {
    if (!data.name || !data.phone || !data.efdaWholesaleLicense) {
      return { success: false, error: 'Name, phone, and EFDA wholesale license are required' };
    }

    const cleanSlug = data.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').substring(0, 16).replace(/_$/, '');
    const randSuffix = Math.floor(1000 + Math.random() * 9000);
    const id = `wholesaler_${cleanSlug}_${randSuffix}`;
    const accessKey = `mf_ws_${cleanSlug.split('_')[0] || 'dist'}_${randSuffix}`;

    const wholesaler: Wholesaler = {
      id,
      name: data.name.trim(),
      subCity: data.subCity ? data.subCity.trim() : 'Bole',
      city: data.city ? data.city.trim() : 'Addis Ababa',
      phone: data.phone.trim(),
      telegramChatId: `tg_${id}`,
      accessKey,
      efdaWholesaleLicense: data.efdaWholesaleLicense.trim(),
      tinNumber: data.tinNumber ? data.tinNumber.trim() : `TIN-${Math.floor(1000000000 + Math.random() * 9000000000)}`,
      isVerified: true,
      trustScore: 98,
      deliveryTerms: data.deliveryTerms ? data.deliveryTerms.trim() : 'Same-Day Dispatch (Within 3 Hours) • EFDA Cold-Chain Certified',
      minimumOrderValueETB: data.minimumOrderValueETB ? Number(data.minimumOrderValueETB) : 2000,
    };

    this.wholesalers.unshift(wholesaler);
    return { success: true, wholesaler };
  }

  public deleteWholesaler(wholesalerId: string): boolean {
    const idx = this.wholesalers.findIndex((w) => w.id === wholesalerId);
    if (idx === -1) return false;
    this.wholesalers.splice(idx, 1);
    // Also remove listings
    this.wholesaleListings = this.wholesaleListings.filter((l) => l.wholesalerId !== wholesalerId);
    return true;
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

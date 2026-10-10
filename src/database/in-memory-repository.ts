import { IDatabaseRepository } from './repository.interface';
import {
  InMemoryDatabase,
  Pharmacy,
  ReservationHold,
  PharmacyVerificationApplication,
  PharmacyPortalAccount,
  AdminUser,
  DemandIntelligenceItem,
  Wholesaler,
  WholesaleListing,
  WholesalePurchaseOrder,
} from './in-memory-db';
import { UserSubscription } from '../monetization/subscription.types';
import { MedicalFuzzyMatcher } from '../matching/medical-fuzzy-matcher';

export class InMemoryRepository implements IDatabaseRepository {
  private db: InMemoryDatabase;

  constructor() {
    this.db = InMemoryDatabase.getInstance();
  }

  private calculateDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371;
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * (Math.PI / 180)) *
        Math.cos(lat2 * (Math.PI / 180)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return parseFloat((R * c).toFixed(2));
  }

  public async searchPharmacies(
    medicineName: string,
    userLat: number,
    userLng: number,
    radiusKm: number = 5
  ): Promise<Array<Pharmacy & { distanceKm: number }>> {
    const query = medicineName.trim().toLowerCase();
    const parsedQuery = query ? MedicalFuzzyMatcher.parseQuery(query) : null;
    const results: Array<Pharmacy & { distanceKm: number }> = [];

    for (const pharmacy of this.db.pharmacies) {
      if (pharmacy.isPermanentlyBanned || pharmacy.isShadowBanned) continue;
      const distanceKm = this.calculateDistanceKm(userLat, userLng, pharmacy.latitude, pharmacy.longitude);

      if (distanceKm <= radiusKm) {
        let matchesMedicine = !query;

        if (parsedQuery && !matchesMedicine) {
          // Check inStockItems quick list
          for (const item of pharmacy.inStockItems) {
            const match = MedicalFuzzyMatcher.matchItem(item, parsedQuery);
            if (match.matched) {
              matchesMedicine = true;
              break;
            }
          }

          // Check structured inventory if not yet matched
          if (!matchesMedicine && pharmacy.inventory) {
            for (const item of pharmacy.inventory) {
              const match = MedicalFuzzyMatcher.matchItem(item.name, parsedQuery);
              if (match.matched) {
                matchesMedicine = true;
                break;
              }
            }
          }
        }

        if (matchesMedicine) {
          results.push({ ...pharmacy, distanceKm });
        }
      }
    }

    return results.sort((a, b) => b.trustScore - a.trustScore || a.distanceKm - b.distanceKm);
  }

  public async getPharmacyById(id: string): Promise<Pharmacy | null> {
    const pharmacy = this.db.pharmacies.find((p) => p.id === id);
    return pharmacy || null;
  }

  public async getAllPharmacies(): Promise<Pharmacy[]> {
    return [...this.db.pharmacies];
  }

  public async createReservationHold(holdData: {
    patientUserId: string;
    pharmacyId: string;
    medicineName: string;
    lockedPriceETB: number;
    durationMinutes?: number;
  }): Promise<ReservationHold | null> {
    return this.db.createReservationHold(holdData);
  }

  public async getReservationHold(code: string): Promise<ReservationHold | null> {
    return this.db.getReservationHold(code);
  }

  public async linkReservationPatientChatId(code: string, chatId: string): Promise<ReservationHold | null> {
    return this.db.linkReservationPatientChatId(code, chatId);
  }

  public async verifyAndFulfillReservation(
    code: string
  ): Promise<{ success: boolean; message: string; reservation?: ReservationHold }> {
    return this.db.verifyAndFulfillReservation(code);
  }

  public async getActiveReservationsByPharmacy(pharmacyId: string): Promise<ReservationHold[]> {
    return this.db.getActiveReservationsByPharmacy(pharmacyId);
  }

  public async confirmReservationHold(
    code: string
  ): Promise<{ success: boolean; message: string; reservation?: ReservationHold }> {
    return this.db.confirmReservationHold(code);
  }

  public async rejectReservationHold(
    code: string,
    reason?: string
  ): Promise<{ success: boolean; message: string; reservation?: ReservationHold }> {
    return this.db.rejectReservationHold(code, reason);
  }

  public async updatePharmacyLocation(
    pharmacyId: string,
    lat: number,
    lng: number,
    subCity?: string,
    addressDetails?: string
  ): Promise<{ success: boolean; pharmacy?: Pharmacy; error?: string }> {
    return this.db.updatePharmacyLocation(pharmacyId, {
      latitude: lat,
      longitude: lng,
      subCity,
      addressDetails,
    });
  }

  public async submitVerificationApplication(
    data: Omit<PharmacyVerificationApplication, 'id' | 'status' | 'submittedAt'>
  ): Promise<PharmacyVerificationApplication> {
    return this.db.submitVerificationApplication(data);
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
    return this.db.reviewVerificationApplication(id, status, adminNotes, efdaLicenseNumber);
  }

  public async magicLoginWithKey(
    accessKey: string
  ): Promise<{ success: boolean; account?: PharmacyPortalAccount; token?: string; sessionExpiresAt?: string; error?: string }> {
    return this.db.magicLoginWithKey(accessKey);
  }

  public async sendPharmacyLoginOtp(
    phone: string
  ): Promise<{ success: boolean; otpCode?: string; telegramChatId?: string; pharmacyName?: string; error?: string }> {
    return this.db.sendPharmacyLoginOtp(phone);
  }

  public async verifyPharmacyLoginOtp(
    phone: string,
    otpCode: string
  ): Promise<{ success: boolean; account?: PharmacyPortalAccount; token?: string; sessionExpiresAt?: string; error?: string }> {
    return this.db.verifyPharmacyLoginOtp(phone, otpCode);
  }

  public async getAccountBySession(token: string): Promise<PharmacyPortalAccount | null> {
    const acc = this.db.getAccountBySession(token);
    return acc || null;
  }

  public async getAccountByAccessKey(accessKey: string): Promise<PharmacyPortalAccount | null> {
    const acc = this.db.getAccountByAccessKey(accessKey);
    return acc || null;
  }

  public async getAccountByPharmacyId(pharmacyId: string): Promise<PharmacyPortalAccount | null> {
    const acc = this.db.getAccountByPharmacyId(pharmacyId);
    return acc || null;
  }

  public async getAccountByTelegramChatId(chatId: string): Promise<PharmacyPortalAccount | null> {
    const acc = this.db.getAccountByTelegramChatId(chatId);
    return acc || null;
  }

  // Deprecated backward compatibility
  public async authenticatePharmacy(username: string, password: string): Promise<{ success: boolean; account?: PharmacyPortalAccount; token?: string; error?: string }> {
    return this.db.authenticatePharmacy(username, password);
  }

  public async getAccountBySetupToken(setupToken: string): Promise<PharmacyPortalAccount | null> {
    return this.getAccountByAccessKey(setupToken);
  }

  public async activateAccountWithToken(setupToken: string, newPassword?: string, _customUsername?: string): Promise<{ success: boolean; account?: PharmacyPortalAccount; token?: string; error?: string }> {
    return this.db.activateAccountWithToken(setupToken, newPassword);
  }

  public async changePharmacyPassword(username: string, currentPassword: string, newPassword: string): Promise<{ success: boolean; account?: PharmacyPortalAccount; error?: string }> {
    return this.db.changePharmacyPassword(username, currentPassword, newPassword);
  }

  public async authenticateAdmin(
    username: string,
    password: string
  ): Promise<{ success: boolean; admin?: Omit<AdminUser, 'passwordHash'>; token?: string; error?: string }> {
    return this.db.authenticateAdmin(username, password);
  }

  public async getAdminBySession(token: string): Promise<AdminUser | null> {
    const admin = this.db.getAdminBySession(token);
    return admin || null;
  }

  public async getOrCreateSubscription(userId: string): Promise<UserSubscription> {
    return this.db.getOrCreateSubscription(userId);
  }

  public async addOrUpdateMedicine(
    pharmacyId: string,
    item: { name: string; genericName?: string; category?: string; priceETB: number; inStock?: boolean }
  ): Promise<boolean> {
    return this.db.addOrUpdateMedicine(pharmacyId, item);
  }

  public async toggleMedicineStock(pharmacyId: string, medicineName: string, inStock: boolean): Promise<boolean> {
    return this.db.toggleMedicineStock(pharmacyId, medicineName, inStock);
  }

  public async removeMedicine(pharmacyId: string, medicineName: string): Promise<boolean> {
    return this.db.removeMedicine(pharmacyId, medicineName);
  }

  public async bulkImportChecklist(
    pharmacyId: string,
    items: Array<{ name: string; priceETB: number; category?: string; genericName?: string }>
  ): Promise<number> {
    return this.db.bulkImportChecklist(pharmacyId, items);
  }

  public async parseAndImportCsv(pharmacyId: string, csvContent: string): Promise<{ imported: number; errors: number }> {
    return this.db.parseAndImportCsv(pharmacyId, csvContent);
  }

  public async reportViolation(params: {
    patientUserId: string;
    pharmacyId: string;
    medicineName: string;
    issueType: 'PRICE_GOUGING' | 'OUT_OF_STOCK_PHANTOM' | 'EXPIRED_MEDICINE' | 'UNPROFESSIONAL';
    description?: string;
  }): Promise<{ success: boolean; strikeCount: number; newTrustScore: number; penaltyApplied: string }> {
    return this.db.reportViolation(params);
  }

  public async getVerificationApplications(): Promise<PharmacyVerificationApplication[]> {
    return [...this.db.verificationApplications];
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
    return this.db.resubmitVerificationApplication(id, updates);
  }

  public async logSearchTelemetry(event: {
    query: string;
    normalizedDrug: string;
    coreBrandOrGeneric: string;
    subCity: string;
    city?: string;
    matchedCount: number;
    userId?: string;
  }): Promise<void> {
    const id = `ev-${Math.floor(100000 + Math.random() * 900000)}`;
    this.db.searchAnalyticsEvents.unshift({
      id,
      query: event.query,
      normalizedDrug: event.normalizedDrug.toLowerCase(),
      coreBrandOrGeneric: event.coreBrandOrGeneric.toLowerCase(),
      subCity: event.subCity || 'Bole',
      city: event.city || 'Addis Ababa',
      matchedCount: event.matchedCount || 0,
      userId: event.userId,
      timestamp: new Date().toISOString(),
    });

    if (this.db.searchAnalyticsEvents.length > 500) {
      this.db.searchAnalyticsEvents.length = 500;
    }
  }

  public async getDemandIntelligence(params?: {
    subCity?: string;
    limit?: number;
    days?: number;
  }): Promise<DemandIntelligenceItem[]> {
    const subFilter = params?.subCity && params.subCity !== 'ALL' ? params.subCity.toLowerCase() : null;
    const limit = params?.limit || 15;

    // Aggregate counts
    const map = new Map<string, { drug: string; subCity: string; count: number; lastAt: string }>();

    for (const ev of this.db.searchAnalyticsEvents) {
      if (subFilter && ev.subCity.toLowerCase() !== subFilter) continue;
      const key = `${ev.coreBrandOrGeneric}__${ev.subCity}`;
      const existing = map.get(key);
      if (existing) {
        existing.count++;
      } else {
        map.set(key, { drug: ev.coreBrandOrGeneric, subCity: ev.subCity, count: 1, lastAt: ev.timestamp });
      }
    }

    const allPharmacies = [...this.db.pharmacies];
    const items: DemandIntelligenceItem[] = [];

    for (const [, item] of map.entries()) {
      const stocking = allPharmacies.filter((p) => {
        if (p.isPermanentlyBanned || p.isShadowBanned) return false;
        if (item.subCity && p.subCity.toLowerCase() !== item.subCity.toLowerCase()) return false;
        const parsed = MedicalFuzzyMatcher.parseQuery(item.drug);
        const hasStock = p.inStockItems?.some((it) => MedicalFuzzyMatcher.matchItem(it, parsed).matched);
        const hasInv = p.inventory?.some((it) => MedicalFuzzyMatcher.matchItem(it.name, parsed).matched);
        return hasStock || hasInv;
      }).length;

      const ratio = parseFloat((item.count / (stocking + 1)).toFixed(2));
      let shortageLevel: 'CRITICAL' | 'HIGH' | 'MODERATE' | 'SUFFICIENT' = 'SUFFICIENT';
      if (stocking === 0 || ratio >= 5) shortageLevel = 'CRITICAL';
      else if (ratio >= 2.5) shortageLevel = 'HIGH';
      else if (ratio >= 1.2) shortageLevel = 'MODERATE';

      const formattedDrug = item.drug.charAt(0).toUpperCase() + item.drug.slice(1);
      items.push({
        drugName: formattedDrug,
        subCity: item.subCity,
        searchCount: item.count,
        stockingPharmaciesCount: stocking,
        unmetDemandRatio: ratio,
        shortageLevel,
        estimatedMissedSalesETB: Math.max(item.count * 85, (item.count - stocking * 5) * 320),
        lastSearchedAt: item.lastAt,
      });
    }

    return items.sort((a, b) => b.searchCount - a.searchCount).slice(0, limit);
  }

  public async setPharmacyAnalyticsAccess(
    pharmacyId: string,
    access: {
      enabled: boolean;
      allowedSubCities?: string[];
      tier?: 'BASIC' | 'PRO' | 'ENTERPRISE';
      expiresAt?: string;
    }
  ): Promise<{ success: boolean; pharmacy?: Pharmacy; error?: string }> {
    const pharm = this.db.pharmacies.find((p) => p.id === pharmacyId);
    if (!pharm) return { success: false, error: 'Pharmacy not found' };

    pharm.analyticsAccess = access;
    return { success: true, pharmacy: pharm };
  }

  public async getWholesaleListings(filter?: { drugName?: string; category?: string; wholesalerId?: string; inStockOnly?: boolean }): Promise<WholesaleListing[]> {
    return this.db.getWholesaleListings(filter);
  }

  public async getWholesaleListingById(id: string): Promise<WholesaleListing | null> {
    return this.db.getWholesaleListingById(id) || null;
  }

  public async matchWholesaleStockForDrug(drugName: string): Promise<WholesaleListing[]> {
    return this.db.matchWholesaleStockForDrug(drugName);
  }

  public async createWholesalePurchaseOrder(orderData: {
    pharmacyId: string;
    listingId: string;
    quantity: number;
    deliveryAddress?: string;
    paymentMethod?: 'COD' | 'TELEBIRR' | 'CBE_BIRR';
    statusNotes?: string;
  }): Promise<{ success: boolean; order?: WholesalePurchaseOrder; error?: string }> {
    return this.db.createWholesalePurchaseOrder(orderData);
  }

  public async getWholesaleOrders(filter?: { pharmacyId?: string; wholesalerId?: string; status?: string }): Promise<WholesalePurchaseOrder[]> {
    return this.db.getWholesaleOrders(filter);
  }

  public async updateWholesaleOrderStatus(
    orderId: string,
    status: 'PENDING' | 'CONFIRMED' | 'DISPATCHED' | 'DELIVERED' | 'CANCELLED',
    statusNotes?: string
  ): Promise<{ success: boolean; order?: WholesalePurchaseOrder; error?: string }> {
    return this.db.updateWholesaleOrderStatus(orderId, status, statusNotes);
  }

  public async getAllWholesalers(): Promise<Wholesaler[]> {
    return this.db.getAllWholesalers();
  }

  public async getB2BCommissionReport(): Promise<{
    totalGrossVolumeETB: number;
    totalPlatformFeesETB: number;
    ordersCount: number;
    orders: WholesalePurchaseOrder[];
  }> {
    return this.db.getB2BCommissionReport();
  }
}

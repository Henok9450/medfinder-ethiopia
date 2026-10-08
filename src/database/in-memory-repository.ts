import { IDatabaseRepository } from './repository.interface';
import {
  InMemoryDatabase,
  Pharmacy,
  ReservationHold,
  PharmacyVerificationApplication,
  PharmacyPortalAccount,
  AdminUser,
} from './in-memory-db';
import { UserSubscription } from '../monetization/subscription.types';

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
    const results: Array<Pharmacy & { distanceKm: number }> = [];

    for (const pharmacy of this.db.pharmacies) {
      if (pharmacy.isPermanentlyBanned || pharmacy.isShadowBanned) continue;
      const distanceKm = this.calculateDistanceKm(userLat, userLng, pharmacy.latitude, pharmacy.longitude);

      if (distanceKm <= radiusKm) {
        const matchesMedicine =
          !query ||
          pharmacy.inStockItems.some((item) => item.includes(query) || query.includes(item));
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
    return this.db.reservations.get(code) || null;
  }

  public async verifyAndFulfillReservation(
    code: string
  ): Promise<{ success: boolean; message: string; reservation?: ReservationHold }> {
    return this.db.verifyAndFulfillReservation(code);
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

  public async authenticatePharmacy(
    username: string,
    password: string
  ): Promise<{ success: boolean; account?: PharmacyPortalAccount; token?: string; error?: string }> {
    return this.db.authenticatePharmacy(username, password);
  }

  public async authenticateAdmin(
    username: string,
    password: string
  ): Promise<{ success: boolean; admin?: Omit<AdminUser, 'passwordHash'>; token?: string; error?: string }> {
    return this.db.authenticateAdmin(username, password);
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
}

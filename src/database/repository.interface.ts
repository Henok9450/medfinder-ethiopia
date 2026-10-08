import {
  Pharmacy,
  ReservationHold,
  PharmacyVerificationApplication,
  PharmacyPortalAccount,
  AdminUser,
} from './in-memory-db';
import { UserSubscription } from '../monetization/subscription.types';

export interface IDatabaseRepository {
  /**
   * Geospatial search for pharmacies within a radius with matching medicine stock
   */
  searchPharmacies(
    medicineName: string,
    userLat: number,
    userLng: number,
    radiusKm?: number
  ): Promise<Array<Pharmacy & { distanceKm: number }>>;

  /**
   * Retrieve a pharmacy by ID
   */
  getPharmacyById(id: string): Promise<Pharmacy | null>;

  /**
   * Retrieve all pharmacies (e.g. for directory or admin views)
   */
  getAllPharmacies(): Promise<Pharmacy[]>;

  /**
   * Create a 1-hour anti-scam price lock reservation
   */
  createReservationHold(holdData: {
    patientUserId: string;
    pharmacyId: string;
    medicineName: string;
    lockedPriceETB: number;
    durationMinutes?: number;
  }): Promise<ReservationHold | null>;

  /**
   * Look up an existing reservation by its 4-digit code
   */
  getReservationHold(code: string): Promise<ReservationHold | null>;

  /**
   * Verify and fulfill an active reservation code
   */
  verifyAndFulfillReservation(
    code: string
  ): Promise<{ success: boolean; message: string; reservation?: ReservationHold }>;

  /**
   * Update pharmacy GPS location & sub-city
   */
  updatePharmacyLocation(
    pharmacyId: string,
    lat: number,
    lng: number,
    subCity?: string,
    addressDetails?: string
  ): Promise<{ success: boolean; pharmacy?: Pharmacy; error?: string }>;

  /**
   * Submit an EFDA pharmacy verification application
   */
  submitVerificationApplication(
    data: Omit<PharmacyVerificationApplication, 'id' | 'status' | 'submittedAt'>
  ): Promise<PharmacyVerificationApplication>;

  /**
   * Review (approve/reject/request info) an application
   */
  reviewVerificationApplication(
    id: string,
    status: 'APPROVED' | 'REJECTED' | 'INFO_REQUESTED',
    adminNotes?: string,
    efdaLicenseNumber?: string
  ): Promise<{
    success: boolean;
    application?: PharmacyVerificationApplication;
    pharmacy?: Pharmacy;
    error?: string;
  }>;

  /**
   * Authenticate a pharmacy portal account
   */
  authenticatePharmacy(
    username: string,
    password: string
  ): Promise<{ success: boolean; account?: PharmacyPortalAccount; token?: string; error?: string }>;

  /**
   * Authenticate an administrative account
   */
  authenticateAdmin(
    username: string,
    password: string
  ): Promise<{ success: boolean; admin?: Omit<AdminUser, 'passwordHash'>; token?: string; error?: string }>;

  /**
   * Get or create a patient user's subscription and search quota
   */
  getOrCreateSubscription(userId: string): Promise<UserSubscription>;

  /**
   * Add or update an inventory medicine item for a pharmacy
   */
  addOrUpdateMedicine(
    pharmacyId: string,
    item: { name: string; genericName?: string; category?: string; priceETB: number; inStock?: boolean }
  ): Promise<boolean>;
}

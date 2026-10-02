import { v4 as uuidv4 } from 'uuid';
import { DynamicConfigService } from '../config/dynamic-config.service';
import { InMemoryDatabase, Pharmacy, BroadcastRequest } from '../database/in-memory-db';

export class BroadcastMatchingService {
  private configService = DynamicConfigService.getInstance();
  private db = InMemoryDatabase.getInstance();

  /**
   * Calculate distance between two lat/lng points in kilometers using Haversine formula
   */
  public calculateDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371; // Earth's radius in km
    const dLat = this.deg2rad(lat2 - lat1);
    const dLon = this.deg2rad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.deg2rad(lat1)) * Math.cos(this.deg2rad(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return parseFloat((R * c).toFixed(2));
  }

  private deg2rad(deg: number): number {
    return deg * (Math.PI / 180);
  }

  /**
   * Search for pre-indexed medicines near user location
   */
  public searchDirectCatalog(params: {
    medicineName: string;
    userLat: number;
    userLng: number;
  }): Array<{ pharmacy: Pharmacy; distanceKm: number }> {
    const policy = this.configService.getPolicy();
    const radius = policy.geoMatching.initialRadiusKm;
    const query = params.medicineName.trim().toLowerCase();

    const matches: Array<{ pharmacy: Pharmacy; distanceKm: number }> = [];

    for (const pharmacy of this.db.pharmacies) {
      if (pharmacy.isPermanentlyBanned) continue;
      const distance = this.calculateDistanceKm(params.userLat, params.userLng, pharmacy.latitude, pharmacy.longitude);
      if (distance <= radius) {
        const hasItem = pharmacy.inStockItems.some((item) => item.includes(query) || query.includes(item));
        if (hasItem) {
          matches.push({ pharmacy, distanceKm: distance });
        }
      }
    }

    // Sort by Trust Score & Distance
    return matches.sort((a, b) => b.pharmacy.trustScore - a.pharmacy.trustScore || a.distanceKm - b.distanceKm);
  }

  /**
   * Creates a Broadcast Ping to nearby pharmacies for elusive/unindexed drugs
   */
  public createBroadcastRequest(params: {
    userId: string;
    medicineName: string;
    userLat: number;
    userLng: number;
  }): BroadcastRequest {
    const policy = this.configService.getPolicy();
    const initialRadius = policy.geoMatching.initialRadiusKm;
    const maxPing = policy.geoMatching.maxPharmaciesPinged;

    // Find nearby pharmacies to ping (Exclude banned or shadowbanned pharmacies)
    const nearby = this.db.pharmacies
      .filter((p) => !p.isPermanentlyBanned && !p.isShadowBanned)
      .map((p) => ({
        pharmacy: p,
        distance: this.calculateDistanceKm(params.userLat, params.userLng, p.latitude, p.longitude),
      }))
      .filter((item) => item.distance <= initialRadius)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, maxPing);

    const requestId = `REQ-${Date.now()}-${uuidv4().substring(0, 5).toUpperCase()}`;

    const request: BroadcastRequest = {
      id: requestId,
      userId: params.userId,
      medicineName: params.medicineName,
      userLat: params.userLat,
      userLng: params.userLng,
      currentRadiusKm: initialRadius,
      pingedPharmacyIds: nearby.map((n) => n.pharmacy.id),
      status: 'PENDING',
      createdAt: new Date().toISOString(),
      responses: [],
    };

    this.db.broadcastRequests.set(requestId, request);

    // Simulated Telegram Bot Ping dispatched to each pharmacy
    console.log(`[BroadcastEngine] Pinging ${nearby.length} pharmacies within ${initialRadius} km for "${params.medicineName}"`);

    return request;
  }

  /**
   * Pharmacist responds with stock availability and price
   */
  public recordPharmacyResponse(params: {
    requestId: string;
    pharmacyId: string;
    hasStock: boolean;
    priceETB?: number;
  }): { success: boolean; message: string; responseCount?: number } {
    const request = this.db.broadcastRequests.get(params.requestId);
    if (!request) return { success: false, message: 'Request not found or expired' };

    const pharmacy = this.db.pharmacies.find((p) => p.id === params.pharmacyId);
    if (!pharmacy) return { success: false, message: 'Pharmacy not recognized' };

    if (!params.hasStock) {
      return { success: true, message: 'Recorded out of stock' };
    }

    const distance = this.calculateDistanceKm(request.userLat, request.userLng, pharmacy.latitude, pharmacy.longitude);

    request.responses.push({
      pharmacyId: pharmacy.id,
      pharmacyName: pharmacy.name,
      priceETB: params.priceETB || 0,
      phone: pharmacy.phone,
      distanceKm: distance,
      respondedAt: new Date().toISOString(),
    });

    request.status = 'FULFILLED';

    return {
      success: true,
      message: 'Stock confirmed and forwarded to patient',
      responseCount: request.responses.length,
    };
  }
}

import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import { SystemPolicy, SystemPolicySchema } from './policy.types';

export class DynamicConfigService extends EventEmitter {
  private static instance: DynamicConfigService;
  private currentPolicy: SystemPolicy;
  private configFilePath: string;

  private constructor() {
    super();
    this.configFilePath = path.resolve(__dirname, '../../config/default-policy.json');
    this.currentPolicy = this.loadPolicy();
  }

  public static getInstance(): DynamicConfigService {
    if (!DynamicConfigService.instance) {
      DynamicConfigService.instance = new DynamicConfigService();
    }
    return DynamicConfigService.instance;
  }

  private loadPolicy(): SystemPolicy {
    try {
      if (fs.existsSync(this.configFilePath)) {
        const raw = fs.readFileSync(this.configFilePath, 'utf-8');
        const parsed = JSON.parse(raw);
        const validated = SystemPolicySchema.parse(parsed);
        return validated;
      }
    } catch (err) {
      console.error('[DynamicConfig] Failed to load config from disk, using fallback defaults:', err);
    }

    // Baseline fallback if file missing
    return {
      version: '1.0.0',
      updatedAt: new Date().toISOString(),
      monetization: {
        globalMode: 'HYBRID',
        freePromotionUntil: '2026-12-31T23:59:59.000Z',
        freemiumQuotaPerMonth: 2,
        pricing: {
          searchFeeETB: 5,
          monthlyPassETB: 25,
          threeMonthPassETB: 60,
          pharmacyMonthlyFeeETB: 0,
        },
        regionalOverrides: [],
        paymentGateways: {
          telebirr: { enabled: true, appId: 'DEV', shortCode: '100', sandbox: true },
          cbeBirr: { enabled: true, sandbox: true },
        },
      },
      geoMatching: {
        initialRadiusKm: 3.5,
        autoExpandOnTimeout: true,
        expandedRadiusKm: 8.0,
        timeoutSecondsBeforeExpand: 90,
        maxPharmaciesPinged: 15,
        requestTtlMinutes: 60,
        allowCompetitiveBids: true,
      },
      features: {
        enablePrescriptionOcr: true,
        enableVoiceSearch: true,
        enablePharmacyDirectCall: true,
        enableMedicineReservationHold: true,
        reservationHoldMinutes: 60,
      },
      localization: {
        defaultLanguage: 'am',
        supportedLanguages: ['am', 'or', 'en'],
        templates: {},
      },
    };
  }

  public getPolicy(): SystemPolicy {
    return this.currentPolicy;
  }

  /**
   * Dynamically update any section of the policy at runtime.
   * Validates against the Zod schema and immediately persists to disk.
   */
  public updatePolicy(partial: Partial<SystemPolicy>): { success: boolean; policy: SystemPolicy; error?: string } {
    try {
      const merged = {
        ...this.currentPolicy,
        ...partial,
        updatedAt: new Date().toISOString(),
      };

      const validated = SystemPolicySchema.parse(merged);
      this.currentPolicy = validated;

      // Persist to disk
      fs.writeFileSync(this.configFilePath, JSON.stringify(validated, null, 2), 'utf-8');
      
      this.emit('policyUpdated', this.currentPolicy);
      console.log(`[DynamicConfig] Policy updated successfully at ${validated.updatedAt}`);
      return { success: true, policy: this.currentPolicy };
    } catch (err: any) {
      console.error('[DynamicConfig] Validation failed on update:', err);
      return { success: false, policy: this.currentPolicy, error: err.message };
    }
  }

  /**
   * Helper to extend or change the Free Promotion End Date on the fly
   */
  public setFreePromotionEndDate(isoDateString: string): { success: boolean; freePromotionUntil?: string; error?: string } {
    const monetization = {
      ...this.currentPolicy.monetization,
      freePromotionUntil: isoDateString,
    };
    const res = this.updatePolicy({ monetization });
    if (res.success) {
      return { success: true, freePromotionUntil: res.policy.monetization.freePromotionUntil };
    }
    return { success: false, error: res.error };
  }
}

import { z } from 'zod';

export type MonetizationMode = 'FREE' | 'FREEMIUM' | 'PAY_PER_USE' | 'SUBSCRIPTION_ONLY' | 'HYBRID';

export const RegionalOverrideSchema = z.object({
  city: z.string(),
  subCity: z.string().optional(),
  mode: z.enum(['FREE', 'FREEMIUM', 'PAY_PER_USE', 'SUBSCRIPTION_ONLY', 'HYBRID']).optional(),
  freePromotionUntil: z.string().datetime().optional(),
  searchFeeETB: z.number().min(0).optional(),
});

export type RegionalOverride = z.infer<typeof RegionalOverrideSchema>;

export const SystemPolicySchema = z.object({
  version: z.string(),
  updatedAt: z.string(),
  
  // 1. DYNAMIC MONETIZATION & PAYWALL POLICY
  monetization: z.object({
    globalMode: z.enum(['FREE', 'FREEMIUM', 'PAY_PER_USE', 'SUBSCRIPTION_ONLY', 'HYBRID']),
    // Date until which the entire platform is 100% free for market penetration
    freePromotionUntil: z.string().datetime(),
    // For FREEMIUM mode: number of free searches allowed per user per month
    freemiumQuotaPerMonth: z.number().int().min(0).default(2),
    // Dynamic tariffs in Ethiopian Birr (ETB)
    pricing: z.object({
      searchFeeETB: z.number().min(0).default(5),
      monthlyPassETB: z.number().min(0).default(25),
      threeMonthPassETB: z.number().min(0).default(60),
      pharmacyMonthlyFeeETB: z.number().min(0).default(0), // 0 during onboarding
    }),
    // Sub-city / regional overrides (e.g. Bole starts paywall earlier, Hawassa remains free)
    regionalOverrides: z.array(RegionalOverrideSchema).default([]),
    // Payment integrations
    paymentGateways: z.object({
      telebirr: z.object({
        enabled: z.boolean().default(true),
        appId: z.string().default('TELEBIRR_APP_ID_DEV'),
        shortCode: z.string().default('100123'),
        sandbox: z.boolean().default(true),
      }),
      cbeBirr: z.object({
        enabled: z.boolean().default(true),
        sandbox: z.boolean().default(true),
      }),
    }),
  }),

  // 2. DYNAMIC GEO-MATCHING & BROADCAST POLICY
  geoMatching: z.object({
    initialRadiusKm: z.number().min(0.5).max(50).default(3.0),
    autoExpandOnTimeout: z.boolean().default(true),
    expandedRadiusKm: z.number().min(1).max(100).default(8.0),
    timeoutSecondsBeforeExpand: z.number().min(10).max(600).default(90),
    maxPharmaciesPinged: z.number().min(1).max(50).default(12),
    requestTtlMinutes: z.number().min(5).max(1440).default(60),
    allowCompetitiveBids: z.boolean().default(true), // Users see all responding pharmacies
  }),

  // 3. DYNAMIC FEATURE FLAGS
  features: z.object({
    enablePrescriptionOcr: z.boolean().default(true),
    geminiApiKey: z.string().optional(),
    enableVoiceSearch: z.boolean().default(true),
    enablePharmacyDirectCall: z.boolean().default(true),
    enableMedicineReservationHold: z.boolean().default(true),
    reservationHoldMinutes: z.number().default(60),
  }),

  // 4. DYNAMIC LOCALIZATION & TEMPLATES
  localization: z.object({
    defaultLanguage: z.enum(['am', 'or', 'en', 'ti']).default('am'),
    supportedLanguages: z.array(z.string()).default(['am', 'or', 'en']),
    templates: z.record(z.string(), z.record(z.string(), z.string())),
  }),
});

export type SystemPolicy = z.infer<typeof SystemPolicySchema>;

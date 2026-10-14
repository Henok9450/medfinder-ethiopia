import express, { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import cors from 'cors';
import dotenv from 'dotenv';
import { DynamicConfigService } from './config/dynamic-config.service';
import { MonetizationService } from './monetization/monetization.service';
import { BroadcastMatchingService } from './matching/broadcast-matching.service';
import { TemplateService } from './localization/template.service';
import { AdminConfigController } from './admin/admin-config.controller';
import { InMemoryDatabase, MASTER_MEDICINE_CATALOG, AdminRole, AdminPrivileges } from './database/in-memory-db';
import { TelegramVerificationBotService } from './verification/telegram-verification-bot.service';
import { getDatabaseRepository, initDatabase, closePostgresPool, isPostgresConnected, getDbPool } from './database';
import { PrescriptionVisionService } from './prescription/prescription-vision.service';
import { MedicalFuzzyMatcher } from './matching/medical-fuzzy-matcher';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ limit: '25mb', extended: true }));
app.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  next();
});
app.use(express.static(path.join(__dirname, '../public'), {
  etag: false,
  maxAge: 0,
}));

const port = process.env.PORT || 4000;

// Initialize core services
const configService = DynamicConfigService.getInstance();
const monetizationService = new MonetizationService();
const broadcastService = new BroadcastMatchingService();
const templateService = new TemplateService();
const adminController = new AdminConfigController();
const db = InMemoryDatabase.getInstance();
const dbRepo = getDatabaseRepository();
const telegramBotService = new TelegramVerificationBotService();
const prescriptionVision = PrescriptionVisionService.getInstance();

// ==========================================
// 0. PRESCRIPTION & MEDICINE VISION AI SCAN
// ==========================================
app.post('/api/prescription/scan', async (req: Request, res: Response) => {
  try {
    const { image, base64Data, mimeType, source } = req.body;
    const rawImage = image || base64Data;
    if (!rawImage || typeof rawImage !== 'string' || rawImage.length < 50) {
      return res.status(400).json({
        success: false,
        error: 'Please provide or take a clear picture of the prescription or medicine box.',
      });
    }

    const result = await prescriptionVision.analyzeImage({
      base64Data: rawImage,
      mimeType: mimeType || 'image/jpeg',
      source: source || 'PATIENT_CAMERA',
    });

    return res.json(result);
  } catch (err: any) {
    console.error('[API /prescription/scan] Error:', err);
    return res.status(500).json({
      success: false,
      error: err.message || 'Prescription scanning failed. Please retry or enter name manually.',
    });
  }
});

// ==========================================
// 1. PATIENT / USER SEARCH ENDPOINT
// ==========================================
app.post('/api/search', async (req: Request, res: Response) => {
  const {
    userId,
    medicineName,
    medicineNames,
    userLat,
    userLng,
    city = 'Addis Ababa',
    subCity,
    searchParadigm = 'NEAR_ME', // 'NEAR_ME' (GPS proximity) | 'SUBCITY' (administrative filter)
    maxRadiusKm,
    lang = 'am',
    silentPoll = false,
  } = req.body;

  const rawItemList: string[] = Array.isArray(medicineNames) && medicineNames.length > 0
    ? medicineNames.map((s: any) => String(s).trim()).filter(Boolean)
    : (medicineName
        ? (String(medicineName).includes('+') ? String(medicineName).split('+') : [String(medicineName)]).map((s: any) => String(s).trim()).filter(Boolean)
        : []);

  if (!userId || rawItemList.length === 0 || userLat === undefined || userLng === undefined) {
    return res.status(400).json({
      success: false,
      error: 'userId, medicineName (or medicineNames array), userLat, and userLng are required.',
    });
  }

  const primaryMedicineName = rawItemList[0];

  // 1. Dynamic Monetization & Paywall Evaluation
  const access = monetizationService.evaluateAccess({ userId, city, subCity });

  if (!access.isAllowed && !silentPoll) {
    // Paywall triggered! Dynamically fetch price from current policy
    const policy = configService.getPolicy();
    const pricing = policy.monetization.pricing;

    // Create a pending single-search invoice for 1-click Telebirr checkout
    const invoice = await monetizationService.generatePaymentInvoice({
      userId,
      purpose: 'SINGLE_SEARCH',
    });

    const paywallMsg = templateService.render('paywall_prompt', lang, {
      amount: pricing.searchFeeETB,
    });

    return res.status(402).json({
      success: false,
      paywallTriggered: true,
      reason: access.reason,
      message: paywallMsg,
      options: {
        payPerSearchETB: pricing.searchFeeETB,
        monthlyPassETB: pricing.monthlyPassETB,
        threeMonthPassETB: pricing.threeMonthPassETB,
      },
      telebirrCheckout: {
        invoiceId: invoice.invoiceId,
        checkoutUrl: invoice.checkoutUrl,
        amountETB: invoice.amountETB,
      },
    });
  }

  // 2. Access is Allowed (Free promo period, active pass, or free quota)
  if (!silentPoll) {
    monetizationService.recordSearchUsage(userId);
  }

  // 3. Search direct indexed inventory for each medicine in the list
  const allPharmacies = await dbRepo.getAllPharmacies();
  
  // Radius calculation:
  // NEAR_ME: ignores administrative boundaries, defaults to 35km or user selected radius (e.g. 3, 5, 10, 25)
  // SUBCITY: allows filtering by specific sub-city with fallback to nearest
  const policyRadius = configService.getPolicy().geoMatching.initialRadiusKm || 15;
  let effectiveRadius = policyRadius;
  if (maxRadiusKm !== undefined && !isNaN(Number(maxRadiusKm))) {
    const numRadius = Number(maxRadiusKm);
    effectiveRadius = numRadius > 0 ? numRadius : 9999;
  } else if (searchParadigm === 'NEAR_ME') {
    effectiveRadius = 35; // Default broad coverage for GPS proximity
  }

  const isSubCityExplicit = searchParadigm === 'SUBCITY' &&
    Boolean(subCity) &&
    subCity !== 'ALL' &&
    subCity !== 'All Sub-Cities' &&
    subCity !== 'All Addis Sub-Cities';
  const targetSubCityLower = isSubCityExplicit ? String(subCity).toLowerCase().trim() : '';

  // Parse queries
  const parsedQueries = rawItemList.map(item => ({
    rawName: item,
    parsed: MedicalFuzzyMatcher.parseQuery(item),
  }));

  // Log telemetry for each searched medicine in background (only on initial explicit search)
  if (!silentPoll) {
    for (const q of parsedQueries) {
      dbRepo.logSearchTelemetry({
        query: q.rawName,
        normalizedDrug: q.parsed.normalizedQuery,
        coreBrandOrGeneric: q.parsed.coreBrandOrGeneric,
        subCity: subCity || 'Bole',
        city: city || 'Addis Ababa',
        matchedCount: 0,
        userId,
      }).catch((err: any) => console.warn('[SearchTelemetry] Error:', err.message));
    }
  }

  // Evaluate pharmacy stock across all searched medicines
  const candidatePharmacies: Array<{
    pharmacy: any;
    distanceKm: number;
    matchedItems: Array<{ queryName: string; matchedName: string; priceETB: number; inStock: boolean }>;
    matchedCount: number;
    totalRequested: number;
    totalBasketPriceETB: number;
    isSingleStop: boolean; // Has ALL items in stock
    isDirectSubCityMatch: boolean;
  }> = [];

  for (const pharmacy of allPharmacies) {
    if (pharmacy.isPermanentlyBanned || pharmacy.isShadowBanned) continue;

    const distance = broadcastService.calculateDistanceKm(
      Number(userLat),
      Number(userLng),
      pharmacy.latitude,
      pharmacy.longitude
    );
    if (effectiveRadius < 9000 && distance > effectiveRadius) continue;

    const isDirectSubCityMatch = isSubCityExplicit
      ? Boolean(pharmacy.subCity && pharmacy.subCity.toLowerCase().includes(targetSubCityLower))
      : true;

    const matchedItems: Array<{ queryName: string; matchedName: string; priceETB: number; inStock: boolean }> = [];
    let basketPrice = 0;

    for (const q of parsedQueries) {
      let foundItem: any = null;
      if (pharmacy.inventory) {
        for (const item of pharmacy.inventory) {
          if (MedicalFuzzyMatcher.matchItem(item.name, q.parsed).matched && item.inStock) {
            foundItem = item;
            break;
          }
        }
      }
      if (!foundItem && pharmacy.inStockItems) {
        const foundStockName = pharmacy.inStockItems.find((it: string) => MedicalFuzzyMatcher.matchItem(it, q.parsed).matched);
        if (foundStockName) {
          foundItem = { name: foundStockName, priceETB: 350, inStock: true };
        }
      }

      if (foundItem) {
        matchedItems.push({
          queryName: q.rawName,
          matchedName: foundItem.name,
          priceETB: foundItem.priceETB || 350,
          inStock: true,
        });
        basketPrice += foundItem.priceETB || 350;
      }
    }

    if (matchedItems.length > 0) {
      candidatePharmacies.push({
        pharmacy,
        distanceKm: distance,
        matchedItems,
        matchedCount: matchedItems.length,
        totalRequested: rawItemList.length,
        totalBasketPriceETB: basketPrice,
        isSingleStop: matchedItems.length === rawItemList.length,
        isDirectSubCityMatch,
      });
    }
  }

  // Sort candidate pharmacies:
  // If Sub-City filter is active:
  // 1. Exact sub-city matches first
  // 2. Single-stop pharmacies (has all items)
  // 3. MatchedCount descending
  // 4. Shortest distance ascending
  //
  // If NEAR_ME (GPS Proximity - Regardless of administrative borders):
  // 1. Single-stop pharmacies (has all items)
  // 2. Shortest physical distance ascending (PURE PROXIMITY FIRST)
  // 3. Matched count descending
  // 4. Trust score descending
  candidatePharmacies.sort((a, b) => {
    if (isSubCityExplicit && a.isDirectSubCityMatch !== b.isDirectSubCityMatch) {
      return a.isDirectSubCityMatch ? -1 : 1;
    }
    if (a.isSingleStop !== b.isSingleStop) return a.isSingleStop ? -1 : 1;
    if (searchParadigm === 'NEAR_ME') {
      if (a.distanceKm !== b.distanceKm) return a.distanceKm - b.distanceKm;
      return b.matchedCount - a.matchedCount;
    }
    if (b.matchedCount !== a.matchedCount) return b.matchedCount - a.matchedCount;
    if (b.pharmacy.trustScore !== a.pharmacy.trustScore) return b.pharmacy.trustScore - a.pharmacy.trustScore;
    return a.distanceKm - b.distanceKm;
  });

  if (candidatePharmacies.length > 0) {
    return res.json({
      success: true,
      mode: 'INSTANT_CATALOG_MATCH',
      searchParadigm: isSubCityExplicit ? 'SUBCITY' : 'NEAR_ME',
      appliedRadiusKm: effectiveRadius >= 9000 ? null : effectiveRadius,
      subCityFilter: isSubCityExplicit ? subCity : null,
      subCityMatchedCount: candidatePharmacies.filter(m => m.isDirectSubCityMatch).length,
      accessReason: access.reason,
      freeUntilDate: access.freeUntilDate,
      remainingFreeSearches: access.remainingFreeSearches,
      resultsCount: candidatePharmacies.length,
      isMultiItem: rawItemList.length > 1,
      searchedMedicines: rawItemList,
      pharmacies: candidatePharmacies.map((m) => {
        const primaryMatched = m.matchedItems[0];
        return {
          id: m.pharmacy.id,
          name: m.pharmacy.name,
          subCity: m.pharmacy.subCity,
          phone: m.pharmacy.phone,
          distanceKm: m.distanceKm,
          isDirectSubCityMatch: m.isDirectSubCityMatch,
          isVerified: m.pharmacy.isVerified,
          efdaLicenseNumber: m.pharmacy.efdaLicenseNumber,
          tinNumber: m.pharmacy.tinNumber,
          trustScore: m.pharmacy.trustScore,
          strikeCount: m.pharmacy.strikeCount,
          matchedDrugName: rawItemList.length > 1
            ? `${m.matchedItems.map(i => i.matchedName).join(' + ')}`
            : (primaryMatched?.matchedName || primaryMedicineName),
          priceETB: rawItemList.length > 1 ? m.totalBasketPriceETB : (primaryMatched?.priceETB || 380),
          freshness: 'FRESH_TODAY',
          isSingleStop: m.isSingleStop,
          matchedCount: m.matchedCount,
          totalRequested: m.totalRequested,
          matchedItems: m.matchedItems,
          totalBasketPriceETB: m.totalBasketPriceETB,
          basketSummaryText: `${m.matchedCount} of ${m.totalRequested} items in stock`,
        };
      }),
    });
  }

  if (silentPoll) {
    return res.json({
      success: true,
      mode: 'STILL_WAITING',
      pharmacies: [],
    });
  }

  // 4. Not in direct index: Initiate Real-Time "Broadcast Ping" to nearby pharmacies
  const broadcastReq = broadcastService.createBroadcastRequest({
    userId,
    medicineName: rawItemList.join(' + '),
    userLat: Number(userLat),
    userLng: Number(userLng),
  });

  return res.json({
    success: true,
    mode: 'BROADCAST_PING_INITIATED',
    accessReason: access.reason,
    freeUntilDate: access.freeUntilDate,
    message: 'Medicine not in static stock. Broadcasting query to nearby pharmacies now...',
    requestId: broadcastReq.id,
    radiusKm: broadcastReq.currentRadiusKm,
    pingedCount: broadcastReq.pingedPharmacyIds.length,
    isMultiItem: rawItemList.length > 1,
    searchedMedicines: rawItemList,
  });
});

// ==========================================
// 2. CHECK BROADCAST STATUS
// ==========================================
app.get('/api/search/broadcast/:requestId', (req: Request, res: Response) => {
  const requestId = String(req.params.requestId);
  const request = db.broadcastRequests.get(requestId);

  if (!request) {
    return res.status(404).json({ success: false, error: 'Broadcast request not found' });
  }

  res.json({
    success: true,
    requestId: request.id,
    status: request.status,
    medicineName: request.medicineName,
    responsesCount: request.responses.length,
    responses: request.responses,
  });
});

// ==========================================
// 3. PHARMACIST RESPONSE (CLAIM & PRICE)
// ==========================================
app.post('/api/pharmacy/respond', (req: Request, res: Response) => {
  const { requestId, pharmacyId, hasStock, priceETB } = req.body;

  if (!requestId || !pharmacyId || hasStock === undefined) {
    return res.status(400).json({ success: false, error: 'requestId, pharmacyId, and hasStock are required' });
  }

  const result = broadcastService.recordPharmacyResponse({
    requestId,
    pharmacyId,
    hasStock: Boolean(hasStock),
    priceETB: priceETB ? Number(priceETB) : undefined,
  });

  return res.json(result);
});

// ==========================================
// 3A. PHARMACY PORTAL PASSWORDLESS AUTHENTICATION
// ==========================================
const handleMagicLogin = async (req: Request, res: Response) => {
  let accessKey = String(req.body.accessKey || req.body.key || req.query.key || req.query.setupToken || '').trim();
  const keyMatch = accessKey.match(/mf_key_[a-fA-F0-9]+/);
  if (keyMatch) {
    accessKey = keyMatch[0];
  }
  if (!accessKey) {
    return res.status(400).json({ success: false, error: 'Access key is required' });
  }

  let result = await dbRepo.magicLoginWithKey(accessKey);
  if (!result.success || !result.account) {
    result = db.magicLoginWithKey(accessKey);
  }
  if (!result.success || !result.account) {
    return res.status(401).json({ success: false, error: result.error || 'Invalid or expired counter access key' });
  }

  const pharmacy = (await dbRepo.getPharmacyById(result.account.pharmacyId)) ||
    db.pharmacies.find((p) => p.id === result.account!.pharmacyId);

  return res.json({
    success: true,
    token: result.token,
    sessionExpiresAt: result.account.sessionExpiresAt,
    account: {
      username: result.account.username,
      pharmacyId: result.account.pharmacyId,
      pharmacyName: result.account.pharmacyName,
      subCity: result.account.subCity,
      phone: result.account.phone,
      accessKey: result.account.accessKey,
    },
    pharmacy: pharmacy ? {
      id: pharmacy.id,
      name: pharmacy.name,
      subCity: pharmacy.subCity,
      phone: pharmacy.phone,
      efdaLicenseNumber: pharmacy.efdaLicenseNumber,
      tinNumber: pharmacy.tinNumber,
      isVerified: pharmacy.isVerified,
      trustScore: pharmacy.trustScore,
      strikeCount: pharmacy.strikeCount,
    } : null,
  });
};

app.post('/api/pharmacy/auth/magic-login', handleMagicLogin);
app.post('/api/pharmacy/magic-login', handleMagicLogin);

app.post('/api/pharmacy/auth/send-otp', async (req: Request, res: Response) => {
  const phone = String(req.body.phone || '').trim();
  if (!phone) {
    return res.status(400).json({ success: false, error: 'Phone number is required' });
  }

  const result = await dbRepo.sendPharmacyLoginOtp(phone);
  if (!result.success) {
    return res.status(404).json({ success: false, error: result.error || 'No registered pharmacy found for this phone number' });
  }

  // If the account has a verified Telegram chat ID, send OTP to Telegram bot immediately
  if (result.telegramChatId && result.otpCode) {
    telegramBotService.notifyPharmacyOtp(
      result.telegramChatId,
      result.otpCode,
      result.pharmacyName
    ).catch((err: any) => console.warn('[OTP Telegram Alert] Failed:', err.message));
  }

  res.json({
    success: true,
    message: 'Login code dispatched to your verified Telegram bot and SMS.',
    demoCode: process.env.NODE_ENV !== 'production' ? result.otpCode : undefined,
  });
});

app.post('/api/pharmacy/auth/verify-otp', async (req: Request, res: Response) => {
  const { phone, otpCode } = req.body;
  if (!phone || !otpCode) {
    return res.status(400).json({ success: false, error: 'Phone number and OTP code are required' });
  }

  const result = await dbRepo.verifyPharmacyLoginOtp(String(phone).trim(), String(otpCode).trim());
  if (!result.success || !result.account) {
    return res.status(401).json({ success: false, error: result.error || 'Invalid or expired OTP code' });
  }

  const pharmacy = await dbRepo.getPharmacyById(result.account.pharmacyId);

  res.json({
    success: true,
    token: result.token,
    sessionExpiresAt: result.account.sessionExpiresAt,
    account: {
      username: result.account.username,
      pharmacyId: result.account.pharmacyId,
      pharmacyName: result.account.pharmacyName,
      subCity: result.account.subCity,
      phone: result.account.phone,
      accessKey: result.account.accessKey,
    },
    pharmacy: pharmacy ? {
      id: pharmacy.id,
      name: pharmacy.name,
      subCity: pharmacy.subCity,
      phone: pharmacy.phone,
      efdaLicenseNumber: pharmacy.efdaLicenseNumber,
      tinNumber: pharmacy.tinNumber,
      isVerified: pharmacy.isVerified,
      trustScore: pharmacy.trustScore,
      strikeCount: pharmacy.strikeCount,
    } : null,
  });
});

// Unified login supporting accessKey or phone+otp
app.post('/api/pharmacy/auth/login', async (req: Request, res: Response) => {
  const { accessKey, key, phone, otpCode, username } = req.body;

  const keyToUse = accessKey || key || (username && String(username).startsWith('mf_key_') ? username : undefined);
  if (keyToUse) {
    const result = await dbRepo.magicLoginWithKey(String(keyToUse));
    if (result.success && result.account) {
      const pharmacy = await dbRepo.getPharmacyById(result.account.pharmacyId);
      return res.json({
        success: true,
        token: result.token,
        sessionExpiresAt: result.account.sessionExpiresAt,
        account: result.account,
        pharmacy,
      });
    }
    return res.status(401).json({ success: false, error: result.error || 'Invalid access key' });
  }

  if (phone && otpCode) {
    const result = await dbRepo.verifyPharmacyLoginOtp(String(phone), String(otpCode));
    if (result.success && result.account) {
      const pharmacy = await dbRepo.getPharmacyById(result.account.pharmacyId);
      return res.json({
        success: true,
        token: result.token,
        sessionExpiresAt: result.account.sessionExpiresAt,
        account: result.account,
        pharmacy,
      });
    }
    return res.status(401).json({ success: false, error: result.error || 'Invalid OTP code' });
  }

  return res.status(400).json({ success: false, error: 'Passwordless 1-click accessKey or phone+otpCode is required' });
});

app.get('/api/pharmacy/auth/verify-token', async (req: Request, res: Response) => {
  const key = String(req.query.key || req.query.token || '').trim();
  if (!key) return res.status(400).json({ success: false, error: 'Key is required' });

  const account = await dbRepo.getAccountByAccessKey(key);
  if (!account) return res.status(404).json({ success: false, error: 'Invalid or expired counter access key' });

  res.json({
    success: true,
    pharmacyName: account.pharmacyName,
    subCity: account.subCity,
    username: account.username,
    accessKey: account.accessKey,
  });
});

app.get('/api/pharmacy/auth/session', async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '') || String(req.query.token || '');
  if (!token) return res.status(401).json({ success: false, error: 'Not authenticated' });

  const account = (await dbRepo.getAccountBySession(token)) || db.getAccountBySession(token);
  if (!account) return res.status(401).json({ success: false, error: 'Session expired (6-month limit reached) or invalid. Use your 1-Click Key or Phone Login to reconnect.' });

  const pharmacy = (await dbRepo.getPharmacyById(account.pharmacyId)) ||
    db.pharmacies.find((p) => p.id === account.pharmacyId);

  res.json({
    success: true,
    sessionExpiresAt: account.sessionExpiresAt,
    account: {
      username: account.username,
      pharmacyId: account.pharmacyId,
      pharmacyName: account.pharmacyName,
      subCity: account.subCity,
      phone: account.phone,
      accessKey: account.accessKey,
    },
    pharmacy: pharmacy ? {
      id: pharmacy.id,
      name: pharmacy.name,
      subCity: pharmacy.subCity,
      phone: pharmacy.phone,
      efdaLicenseNumber: pharmacy.efdaLicenseNumber,
      tinNumber: pharmacy.tinNumber,
      isVerified: pharmacy.isVerified,
      trustScore: pharmacy.trustScore,
      strikeCount: pharmacy.strikeCount,
    } : null,
  });
});

app.post('/api/pharmacy/auth/logout', async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '') || String(req.body.token || '');
  if (token) {
    const account = await dbRepo.getAccountBySession(token);
    if (account) {
      account.sessionToken = undefined;
      account.sessionExpiresAt = undefined;
    }
  }
  res.json({ success: true, message: 'Counter session logged out successfully.' });
});

// Dedicated Pharmacy PWA direct route
app.get(['/pharmacy', '/pharmacy/setup', '/pharmacy/index.html'], (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, '../public/pharmacy/index.html'));
});

// Update Pharmacy GPS Location from Counter Web Studio
app.post('/api/pharmacy/:pharmacyId/location', async (req: Request, res: Response) => {
  const pharmacyId = String(req.params.pharmacyId);
  const { latitude, longitude, subCity, addressDetails } = req.body;

  if (latitude === undefined || longitude === undefined) {
    return res.status(400).json({ success: false, error: 'latitude and longitude are required' });
  }

  const result = await dbRepo.updatePharmacyLocation(
    pharmacyId,
    Number(latitude),
    Number(longitude),
    subCity ? String(subCity) : undefined,
    addressDetails ? String(addressDetails) : undefined
  );

  if (!result.success) {
    return res.status(404).json(result);
  }

  res.json({
    success: true,
    message: 'Counter GPS location locked successfully!',
    pharmacy: {
      id: result.pharmacy?.id,
      name: result.pharmacy?.name,
      subCity: result.pharmacy?.subCity,
      latitude: result.pharmacy?.latitude,
      longitude: result.pharmacy?.longitude,
      address: result.pharmacy?.address,
    },
  });
});

// ==========================================
// 3B. PHARMACY INVENTORY & STOCK MANAGEMENT
// ==========================================
// 1. Get Ethiopia's Master Drug Catalog for quick checklist
app.get('/api/pharmacy/catalog/master', (req: Request, res: Response) => {
  res.json({ success: true, catalog: MASTER_MEDICINE_CATALOG });
});

// 2. Fetch specific pharmacy inventory
app.get('/api/pharmacy/:pharmacyId/inventory', async (req: Request, res: Response) => {
  const pharmacyId = String(req.params.pharmacyId);
  const pharmacy = await dbRepo.getPharmacyById(pharmacyId);
  if (!pharmacy) return res.status(404).json({ success: false, error: 'Pharmacy not found' });
  res.json({
    success: true,
    pharmacy: { id: pharmacy.id, name: pharmacy.name, subCity: pharmacy.subCity, phone: pharmacy.phone },
    inventory: pharmacy.inventory,
  });
});

// 3. Register or update a single medicine
app.post('/api/pharmacy/:pharmacyId/inventory/add', async (req: Request, res: Response) => {
  const pharmacyId = String(req.params.pharmacyId);
  const { name, genericName, category, priceETB, inStock } = req.body;
  if (!name || priceETB === undefined) {
    return res.status(400).json({ success: false, error: 'name and priceETB are required' });
  }
  const success = await dbRepo.addOrUpdateMedicine(pharmacyId, {
    name,
    genericName,
    category,
    priceETB: Number(priceETB),
    inStock: inStock !== undefined ? Boolean(inStock) : true,
  });
  res.json({ success, message: success ? 'Medicine registered successfully' : 'Failed to register' });
});

// 4. Bulk 1-Click Checklist Registration
app.post('/api/pharmacy/:pharmacyId/inventory/checklist', async (req: Request, res: Response) => {
  const pharmacyId = String(req.params.pharmacyId);
  const { items } = req.body;
  if (!Array.isArray(items)) {
    return res.status(400).json({ success: false, error: 'items array is required' });
  }
  const count = await dbRepo.bulkImportChecklist(pharmacyId, items);
  res.json({ success: true, count, message: `Successfully registered ${count} medicines from checklist.` });
});

// 5. Excel / CSV Bulk Inventory Import
app.post('/api/pharmacy/:pharmacyId/inventory/csv', async (req: Request, res: Response) => {
  const pharmacyId = String(req.params.pharmacyId);
  const { csvContent } = req.body;
  if (!csvContent) {
    return res.status(400).json({ success: false, error: 'csvContent is required' });
  }
  const result = await dbRepo.parseAndImportCsv(pharmacyId, String(csvContent));
  res.json({ success: true, ...result, message: `Imported ${result.imported} items with ${result.errors} errors.` });
});

// 6. Toggle Stock In/Out
app.post('/api/pharmacy/:pharmacyId/inventory/toggle', async (req: Request, res: Response) => {
  const pharmacyId = String(req.params.pharmacyId);
  const { medicineName, inStock } = req.body;
  const success = await dbRepo.toggleMedicineStock(pharmacyId, String(medicineName), Boolean(inStock));
  res.json({ success, inStock: Boolean(inStock) });
});

// 7. Delete Item from Shelf
app.delete('/api/pharmacy/:pharmacyId/inventory/:medicineName', async (req: Request, res: Response) => {
  const pharmacyId = String(req.params.pharmacyId);
  const medicineName = String(req.params.medicineName);
  const success = await dbRepo.removeMedicine(pharmacyId, medicineName);
  res.json({ success, message: 'Removed from inventory' });
});

// ==========================================
// 3C. ANTI-SCAM & PRICE-LOCK RESERVATION APIS
// ==========================================
// 1. Create a 60-Minute Price Lock Reservation Hold (Protects patient from bait-and-switch)
app.post('/api/reservation/create', async (req: Request, res: Response) => {
  const { patientUserId, pharmacyId, medicineName, lockedPriceETB } = req.body;
  if (!patientUserId || !pharmacyId || !medicineName || lockedPriceETB === undefined) {
    return res.status(400).json({ success: false, error: 'Missing required reservation fields' });
  }

  const hold = await dbRepo.createReservationHold({
    patientUserId,
    pharmacyId,
    medicineName,
    lockedPriceETB: Number(lockedPriceETB),
  });

  if (!hold) {
    return res.status(400).json({
      success: false,
      error: 'Could not create reservation hold. Either the pharmacy is unrecognized/banned, or you have reached the maximum quota of 2 active reservations.',
    });
  }

  // Push immediate real-time alert to the pharmacy's Telegram counter bot
  const pharmacy = await dbRepo.getPharmacyById(pharmacyId);
  if (pharmacy?.telegramChatId) {
    const expTime = new Date(hold.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    telegramBotService.notifyPharmacyReservationHold({
      pharmacyChatId: pharmacy.telegramChatId,
      pharmacyName: pharmacy.name,
      drugName: medicineName,
      priceETB: hold.lockedPriceETB,
      reservationCode: hold.reservationCode,
      expiresAt: expTime,
      patientChatId: patientUserId,
    }).catch((err: any) => console.warn('[Reservation] Telegram alert to pharmacy failed:', err.message));
  }

  if (pharmacy) {
    hold.latitude = pharmacy.latitude;
    hold.longitude = pharmacy.longitude;
    hold.subCity = hold.subCity || pharmacy.subCity;
    hold.address = hold.address || pharmacy.address;
  }

  res.json({
    success: true,
    message: `Price locked at ${hold.lockedPriceETB} ETB for 60 minutes.`,
    reservation: hold,
    pharmacy: pharmacy ? {
      id: pharmacy.id,
      name: pharmacy.name,
      subCity: pharmacy.subCity,
      phone: pharmacy.phone,
      address: pharmacy.address,
      latitude: pharmacy.latitude,
      longitude: pharmacy.longitude,
    } : undefined,
  });
});

// 2. Counter verification by pharmacist when patient arrives
app.post('/api/reservation/verify', async (req: Request, res: Response) => {
  const code = (req.body.reservationCode || req.body.code || '').toString().trim().replace(/^#/, '');
  if (!code) return res.status(400).json({ success: false, error: 'reservationCode is required' });

  const result = await dbRepo.verifyAndFulfillReservation(code);
  const hold = result.reservation;

  if (result.success && hold?.patientUserId && /^\d+$/.test(hold.patientUserId)) {
    telegramBotService.notifyPatientVoucherFulfilled(hold).catch((err: any) =>
      console.warn('[VoucherFulfill] Patient notify error:', err.message)
    );
  }

  res.json({
    ...result,
    hold,
    reservation: hold,
    error: result.success ? undefined : (result.message || 'Voucher not found or expired'),
  });
});

// 2B. Retrieve all active incoming reservations for a specific pharmacy counter
app.get('/api/reservation/active/:pharmacyId', async (req: Request, res: Response) => {
  const pharmacyId = String(req.params.pharmacyId);
  const reservations = await dbRepo.getActiveReservationsByPharmacy(pharmacyId);
  res.json({
    success: true,
    count: reservations.length,
    reservations,
  });
});

// 2C. Pharmacist two-way acknowledgment of shelf stock
app.post('/api/reservation/confirm', async (req: Request, res: Response) => {
  const { reservationCode } = req.body;
  if (!reservationCode) return res.status(400).json({ success: false, error: 'reservationCode is required' });

  const result = await dbRepo.confirmReservationHold(String(reservationCode));
  if (result.success && result.reservation) {
    if (result.reservation.patientUserId && /^\d+$/.test(result.reservation.patientUserId)) {
      telegramBotService.notifyPatientStockConfirmed(result.reservation).catch((err: any) =>
        console.warn('[ReservationConfirm] Patient alert failed:', err.message)
      );
    }
  }
  res.json(result);
});

// 2D. Pharmacist rejection of hold (Out of stock at counter)
app.post('/api/reservation/reject', async (req: Request, res: Response) => {
  const { reservationCode, reason } = req.body;
  if (!reservationCode) return res.status(400).json({ success: false, error: 'reservationCode is required' });

  const result = await dbRepo.rejectReservationHold(String(reservationCode), reason);
  if (result.success && result.reservation) {
    if (result.reservation.patientUserId && /^\d+$/.test(result.reservation.patientUserId)) {
      telegramBotService.notifyPatientStockUnavailable(result.reservation).catch((err: any) =>
        console.warn('[ReservationReject] Patient alert failed:', err.message)
      );
    }
  }
  res.json(result);
});

// 2E. Real-time Reservation Status Inquiry (Polling & Deep Linking for Web & Telegram)
app.get('/api/reservation/status/:code', async (req: Request, res: Response) => {
  const code = String(req.params.code || '').trim();
  if (!code) return res.status(400).json({ success: false, error: 'code is required' });

  const hold = await dbRepo.getReservationHold(code);
  if (!hold) {
    return res.status(404).json({ success: false, error: 'Reservation code not found' });
  }

  // Check if expired dynamically
  if (hold.status === 'ACTIVE' && new Date() > new Date(hold.expiresAt)) {
    hold.status = 'EXPIRED';
  }

  let pharmacy = null;
  if (hold.pharmacyId && (!hold.latitude || !hold.longitude)) {
    pharmacy = await dbRepo.getPharmacyById(hold.pharmacyId);
    if (pharmacy) {
      hold.latitude = pharmacy.latitude;
      hold.longitude = pharmacy.longitude;
      hold.subCity = hold.subCity || pharmacy.subCity;
      hold.address = hold.address || pharmacy.address;
    }
  }

  res.json({
    success: true,
    reservation: hold,
    pharmacy: pharmacy || (hold.pharmacyId ? {
      id: hold.pharmacyId,
      name: hold.pharmacyName,
      subCity: hold.subCity,
      phone: hold.phone,
      address: hold.address,
      latitude: hold.latitude,
      longitude: hold.longitude,
    } : undefined),
  });
});

// 2F. Link Telegram Chat ID to a Web-initiated Reservation
app.post('/api/reservation/link-telegram', async (req: Request, res: Response) => {
  const { reservationCode, chatId } = req.body;
  if (!reservationCode || !chatId) {
    return res.status(400).json({ success: false, error: 'reservationCode and chatId are required' });
  }

  const updated = await dbRepo.linkReservationPatientChatId(String(reservationCode), String(chatId));
  if (!updated) {
    return res.status(404).json({ success: false, error: 'Reservation not found' });
  }

  // If already confirmed or cancelled, alert immediately on link
  if (updated.status === 'CANCELLED') {
    telegramBotService.notifyPatientStockUnavailable(updated).catch(() => {});
  } else if (updated.pharmacistAcknowledged) {
    telegramBotService.notifyPatientStockConfirmed(updated).catch(() => {});
  }

  res.json({
    success: true,
    message: 'Telegram notifications linked to reservation voucher.',
    reservation: updated,
  });
});

// 3. Patient reports violation (Price Gouging, Phantom Stock, Expired Drug)
app.post('/api/report/violation', async (req: Request, res: Response) => {
  const { patientUserId, pharmacyId, medicineName, issueType, description } = req.body;
  if (!patientUserId || !pharmacyId || !issueType) {
    return res.status(400).json({ success: false, error: 'patientUserId, pharmacyId, and issueType are required' });
  }
  const result = await dbRepo.reportViolation({
    patientUserId,
    pharmacyId,
    medicineName: medicineName || 'Unspecified Drug',
    issueType,
    description,
  });
  res.json(result);
});

// 4. Pharmacy Trust Metrics and regulatory license inquiry
app.get('/api/pharmacy/:pharmacyId/trust', async (req: Request, res: Response) => {
  const pharmacyId = String(req.params.pharmacyId);
  const pharmacy = await dbRepo.getPharmacyById(pharmacyId);
  if (!pharmacy) return res.status(404).json({ success: false, error: 'Pharmacy not found' });
  res.json({
    success: true,
    pharmacy: {
      id: pharmacy.id,
      name: pharmacy.name,
      efdaLicenseNumber: pharmacy.efdaLicenseNumber,
      tinNumber: pharmacy.tinNumber,
      trustScore: pharmacy.trustScore,
      strikeCount: pharmacy.strikeCount,
      isVerified: pharmacy.isVerified,
      isShadowBanned: pharmacy.isShadowBanned,
      isPermanentlyBanned: pharmacy.isPermanentlyBanned,
    },
    reports: db.violationReports.filter((r) => r.pharmacyId === pharmacyId),
  });
});

// ==========================================
// 4. TELEBIRR PAYMENT CHECKOUT & WEBHOOK
// ==========================================
app.post('/api/payment/checkout', async (req: Request, res: Response) => {
  const { userId, purpose = 'MONTHLY_PASS' } = req.body;

  if (!userId) {
    return res.status(400).json({ success: false, error: 'userId is required' });
  }

  const invoice = await monetizationService.generatePaymentInvoice({
    userId,
    purpose: purpose as any,
  });

  res.json({
    success: true,
    invoice,
  });
});

// Webhook for Telebirr / CBE Birr instant notification
app.post('/api/payment/webhook', (req: Request, res: Response) => {
  const { outTradeNo, tradeStatus = 'Completed' } = req.body;

  if (!outTradeNo) {
    return res.status(400).json({ success: false, error: 'outTradeNo is required' });
  }

  if (tradeStatus === 'Completed') {
    const success = monetizationService.completePayment(outTradeNo);
    return res.json({ success, message: 'Payment confirmed. Subscription or quota updated.' });
  }

  return res.json({ success: false, message: 'Payment status not completed' });
});

// ==========================================
// 5. ADMIN AUTHENTICATION, RBAC & POLICY CONTROL
// ==========================================

// Middleware for Admin Authentication
const requireAdminAuth = async (req: Request, res: Response, next: any) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '') || String(req.query.adminToken || '');
  if (!token) {
    return res.status(401).json({ success: false, error: 'Administrator authentication required.' });
  }

  let admin: any = await dbRepo.getAdminBySession(token);
  if (!admin) {
    admin = db.getAdminBySession(token);
  }
  if (!admin) {
    return res.status(401).json({ success: false, error: 'Session expired or invalid credentials.' });
  }

  (req as any).adminUser = admin;
  next();
};

// Middleware for Role/Privilege Enforcement
const requirePrivilege = (privilegeKey: keyof AdminPrivileges) => {
  return (req: Request, res: Response, next: any) => {
    const admin = (req as any).adminUser;
    if (!admin) {
      return res.status(401).json({ success: false, error: 'Administrator authentication required.' });
    }
    if (admin.role === 'SUPER_ADMIN' || admin.privileges?.[privilegeKey]) {
      return next();
    }
    return res.status(403).json({
      success: false,
      error: `Access denied. Your role (${admin.role}) lacks the required '${privilegeKey}' privilege.`,
    });
  };
};

// ==========================================
// UNIFIED PLATFORM AUTHENTICATION (ALL ROLES)
// ==========================================
app.post('/api/auth/login', async (req: Request, res: Response) => {
  const { username, password, accessKey, key } = req.body;

  // 0. Support 1-Click Access Key passwordless login
  const magicKey = accessKey || key || (username && String(username).startsWith('mf_key_') ? username : undefined);
  if (magicKey) {
    const magicResult = await dbRepo.magicLoginWithKey(String(magicKey));
    if (magicResult.success && magicResult.account) {
      const pharmacy = await dbRepo.getPharmacyById(magicResult.account.pharmacyId);
      return res.json({
        success: true,
        userType: 'PHARMACY',
        token: magicResult.token,
        sessionExpiresAt: magicResult.account.sessionExpiresAt,
        user: {
          id: magicResult.account.id,
          username: magicResult.account.username,
          fullName: magicResult.account.pharmacyName,
          pharmacyId: magicResult.account.pharmacyId,
          type: 'PHARMACY',
        },
        pharmacy,
      });
    }
  }

  if (!username || !password) {
    return res.status(400).json({ success: false, error: 'Username and password or accessKey are required' });
  }

  // 1. Check Administrator credentials
  const adminAuth = await dbRepo.authenticateAdmin(String(username), String(password));
  if (adminAuth.success && adminAuth.admin) {
    return res.json({
      success: true,
      userType: 'ADMIN',
      token: adminAuth.token,
      sessionExpiresAt: adminAuth.sessionExpiresAt,
      user: {
        ...adminAuth.admin,
        type: 'ADMIN'
      }
    });
  }

  return res.status(401).json({ success: false, error: 'Invalid credentials. Pharmacies authenticate passwordless with counter accessKey.' });
});

app.get('/api/auth/session', async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '') || String(req.query.token || '');
  if (!token) return res.status(401).json({ success: false, error: 'No active session token' });

  // 1. Check Admin Session
  let admin: any = await dbRepo.getAdminBySession(token);
  if (!admin) {
    admin = db.getAdminBySession(token);
  }
  if (admin) {
    const { passwordHash, ...safeAdmin } = admin;
    return res.json({
      success: true,
      userType: 'ADMIN',
      sessionExpiresAt: admin.sessionExpiresAt,
      user: { ...safeAdmin, type: 'ADMIN' }
    });
  }

  // 2. Check Pharmacy Session
  const pharmAccount = await dbRepo.getAccountBySession(token);
  if (pharmAccount) {
    const pharmacy = await dbRepo.getPharmacyById(pharmAccount.pharmacyId);
    return res.json({
      success: true,
      userType: 'PHARMACY',
      mustChangePassword: pharmAccount.mustChangePassword,
      user: {
        id: pharmAccount.id,
        username: pharmAccount.username,
        fullName: pharmAccount.pharmacyName,
        pharmacyId: pharmAccount.pharmacyId,
        type: 'PHARMACY'
      },
      pharmacy
    });
  }

  return res.status(401).json({ success: false, error: 'Session expired or invalid' });
});

app.post('/api/auth/logout', async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '') || String(req.query.token || '');
  if (token) {
    const admin = db.getAdminBySession(token);
    if (admin) admin.sessionToken = undefined;

    const account = db.getAccountBySession(token);
    if (account) account.sessionToken = undefined;

    const pool = getDbPool();
    if (pool) {
      await pool.query('UPDATE admin_users SET session_token = NULL WHERE session_token = $1', [token]);
      await pool.query('UPDATE pharmacy_portal_accounts SET session_token = NULL WHERE session_token = $1', [token]);
    }
  }
  res.json({ success: true, message: 'Logged out successfully' });
});

// --- Admin Auth Endpoints ---
app.post('/api/admin/auth/login', async (req: Request, res: Response) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, error: 'Username and password are required' });
  }

  const result = await dbRepo.authenticateAdmin(String(username), String(password));
  if (!result.success) {
    return res.status(401).json({ success: false, error: result.error || 'Invalid administrator credentials' });
  }

  return res.json({
    success: true,
    token: result.token,
    sessionExpiresAt: result.sessionExpiresAt,
    admin: result.admin,
  });
});

app.get('/api/admin/auth/session', requireAdminAuth, (req: Request, res: Response) => {
  const admin = (req as any).adminUser;
  const { passwordHash, ...safeAdmin } = admin;
  res.json({
    success: true,
    sessionExpiresAt: admin.sessionExpiresAt,
    admin: safeAdmin,
  });
});

app.post('/api/admin/auth/logout', requireAdminAuth, (req: Request, res: Response) => {
  const admin = (req as any).adminUser;
  if (admin) {
    admin.sessionToken = undefined;
  }
  res.json({ success: true, message: 'Logged out successfully' });
});

// --- Admin Credential & RBAC Privileges Management ---
app.get('/api/admin/users', requireAdminAuth, requirePrivilege('canManageAdmins'), (_req: Request, res: Response) => {
  const admins = db.listAdmins();
  res.json({ success: true, admins });
});

app.post('/api/admin/users', requireAdminAuth, requirePrivilege('canManageAdmins'), (req: Request, res: Response) => {
  const { username, fullName, email, password, role, privileges } = req.body;
  if (!username || !password || !role) {
    return res.status(400).json({ success: false, error: 'Username, password, and role are required' });
  }

  const result = db.createAdmin({
    username: String(username),
    fullName: String(fullName || username),
    email: String(email || `${username}@efda.gov.et`),
    password: String(password),
    role: role as AdminRole,
    privileges,
  });

  if (!result.success) {
    return res.status(400).json({ success: false, error: result.error });
  }

  res.json({ success: true, admin: result.admin });
});

app.put('/api/admin/users/:id/privileges', requireAdminAuth, requirePrivilege('canManageAdmins'), (req: Request, res: Response) => {
  const adminId = String(req.params.id);
  const { role, privileges } = req.body;

  const result = db.updateAdminPrivileges(adminId, { role, privileges });
  if (!result.success) {
    return res.status(400).json({ success: false, error: result.error });
  }

  res.json({ success: true, admin: result.admin });
});

app.delete('/api/admin/users/:id', requireAdminAuth, requirePrivilege('canManageAdmins'), (req: Request, res: Response) => {
  const adminId = String(req.params.id);
  const result = db.deleteAdmin(adminId);
  if (!result.success) {
    return res.status(400).json({ success: false, error: result.error });
  }
  res.json({ success: true, message: 'Administrator user deleted successfully' });
});

// --- Dynamic Admin Configuration & Stats ---
app.get('/api/admin/config', adminController.getConfig);
app.post('/api/admin/config', requireAdminAuth, requirePrivilege('canManagePolicies'), adminController.updateConfig);
app.post('/api/admin/config/set-free-period', requireAdminAuth, requirePrivilege('canManagePolicies'), adminController.setFreePeriod);
app.post('/api/admin/config/test-vision-key', requireAdminAuth, requirePrivilege('canManagePolicies'), adminController.testVisionKey);
app.get('/api/admin/stats', adminController.getStats);

// 6. REGULATORY COMPLIANCE & PHARMACY VERIFICATION DESK
app.get('/api/admin/pharmacies', async (_req: Request, res: Response) => {
  const pharms = await dbRepo.getAllPharmacies();
  res.json({
    success: true,
    pharmacies: pharms.map((p) => ({
      id: p.id,
      name: p.name,
      subCity: p.subCity,
      phone: p.phone,
      efdaLicenseNumber: p.efdaLicenseNumber,
      tinNumber: p.tinNumber,
      isVerified: p.isVerified,
      trustScore: p.trustScore,
      strikeCount: p.strikeCount,
      isPermanentlyBanned: p.isPermanentlyBanned,
      analyticsAccess: p.analyticsAccess || { enabled: false, tier: 'BASIC' },
    })),
  });
});

app.get('/api/pharmacies', async (_req: Request, res: Response) => {
  const pharms = await dbRepo.getAllPharmacies();
  res.json({
    success: true,
    pharmacies: pharms.map((p) => ({
      id: p.id,
      name: p.name,
      subCity: p.subCity,
      phone: p.phone,
      efdaLicenseNumber: p.efdaLicenseNumber,
      tinNumber: p.tinNumber,
      isVerified: p.isVerified,
      trustScore: p.trustScore,
      strikeCount: p.strikeCount,
      isPermanentlyBanned: p.isPermanentlyBanned,
      analyticsAccess: p.analyticsAccess || { enabled: false, tier: 'BASIC' },
    })),
  });
});

app.post('/api/admin/pharmacy/toggle-verification', requireAdminAuth, requirePrivilege('canReviewApplications'), (req: Request, res: Response) => {
  const { pharmacyId } = req.body;
  const pharm = db.pharmacies.find((p) => p.id === pharmacyId);
  if (!pharm) return res.status(404).json({ success: false, error: 'Pharmacy not found' });
  pharm.isVerified = !pharm.isVerified;
  res.json({ success: true, pharmacyId: pharm.id, isVerified: pharm.isVerified });
});

// ==========================================
// 6B. DEMAND INTELLIGENCE & SHORTAGE ANALYTICS
// ==========================================

// Endpoint for retrieving neighborhood drug demand & stock-out radar
app.get('/api/analytics/demand', async (req: Request, res: Response) => {
  try {
    const pharmacyId = req.query.pharmacyId ? String(req.query.pharmacyId) : undefined;
    const subCityParam = req.query.subCity ? String(req.query.subCity) : undefined;
    const days = req.query.days ? parseInt(String(req.query.days), 10) : 14;

    // Check if called with an admin session
    const adminToken = (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || String(req.query.adminToken || '');
    let isAdmin = false;
    if (adminToken) {
      const admin = (await dbRepo.getAdminBySession(adminToken)) || db.getAdminBySession(adminToken);
      if (admin) isAdmin = true;
    }

    let allowedSubCities: string[] | undefined = undefined;
    let pharmacyTier = 'BASIC';
    let isPharmacyLocked = false;

    if (pharmacyId && !isAdmin) {
      const pharmacy = await dbRepo.getPharmacyById(pharmacyId);
      if (!pharmacy) {
        return res.status(404).json({ success: false, error: 'Pharmacy not found' });
      }

      const access = pharmacy.analyticsAccess;
      if (!access || access.enabled !== true) {
        isPharmacyLocked = true;
      } else {
        pharmacyTier = access.tier || 'PRO';
        if (access.allowedSubCities && access.allowedSubCities.length > 0) {
          allowedSubCities = access.allowedSubCities;
        } else if (pharmacy.subCity) {
          allowedSubCities = [pharmacy.subCity];
        }
      }
    }

    // If locked for this pharmacy, return teaser metadata with blur
    if (isPharmacyLocked) {
      // Get sample teaser data (masked counts)
      const fullIntel = await dbRepo.getDemandIntelligence({
        subCity: subCityParam,
        days: days || 14,
        limit: 5,
      });

      const teaserItems = fullIntel.map((item) => ({
        drugName: item.drugName,
        subCity: item.subCity,
        searchCountMasked: '🔒 Premium Tier',
        stockingPharmaciesCount: item.stockingPharmaciesCount,
        unmetDemandRatio: '🔒 Locked',
        shortageLevel: item.shortageLevel,
        estimatedMissedSalesETB: item.estimatedMissedSalesETB,
        lastSearchedAt: item.lastSearchedAt,
      }));

      return res.json({
        success: true,
        locked: true,
        tier: pharmacyTier,
        message: 'Demand Radar analytics is locked for this pharmacy counter. Upgrade your subscription to unlock real-time patient shortage telemetry.',
        teaserCount: teaserItems.length,
        teaser: teaserItems,
      });
    }

    // Determine target sub-city filter
    let effectiveSubCity = subCityParam;
    if (!isAdmin && allowedSubCities && allowedSubCities.length > 0) {
      if (effectiveSubCity && effectiveSubCity !== 'ALL' && !allowedSubCities.map((s) => s.toLowerCase()).includes(effectiveSubCity.toLowerCase())) {
        return res.status(403).json({
          success: false,
          error: `Your subscription does not cover analytics for sub-city "${effectiveSubCity}". Allowed: ${allowedSubCities.join(', ')}`,
        });
      }
      if (!effectiveSubCity || effectiveSubCity === 'ALL') {
        effectiveSubCity = allowedSubCities[0];
      }
    }

    const demandItems = await dbRepo.getDemandIntelligence({
      subCity: effectiveSubCity,
      days: days || 14,
      limit: 25,
    });

    const totalShortagePressure = demandItems.filter((i) => i.shortageLevel === 'CRITICAL' || i.shortageLevel === 'HIGH').length;
    const totalPotentialOpportunityETB = demandItems.reduce((acc, curr) => acc + (curr.estimatedMissedSalesETB || 0), 0);

    return res.json({
      success: true,
      locked: false,
      tier: pharmacyTier,
      subCity: effectiveSubCity || 'ALL',
      allowedSubCities: allowedSubCities || ['ALL'],
      summary: {
        totalShortagePressure,
        totalTrackedDrugs: demandItems.length,
        totalPotentialOpportunityETB,
      },
      items: demandItems,
    });
  } catch (err: any) {
    console.error('[API /analytics/demand] Error:', err);
    return res.status(500).json({ success: false, error: err.message || 'Analytics query failed' });
  }
});

// Admin-only endpoint: Grant, update, or revoke a pharmacy's analytics access
app.post(
  '/api/admin/pharmacy/:id/analytics-access',
  requireAdminAuth,
  requirePrivilege('canManagePolicies'),
  async (req: Request, res: Response) => {
    try {
      const pharmacyId = String(req.params.id);
      const { enabled, allowedSubCities, tier, expiresAt } = req.body;

      if (typeof enabled !== 'boolean') {
        return res.status(400).json({ success: false, error: '"enabled" boolean flag is required' });
      }

      const accessData = {
        enabled: Boolean(enabled),
        allowedSubCities: Array.isArray(allowedSubCities) ? allowedSubCities : undefined,
        tier: (['BASIC', 'PRO', 'ENTERPRISE'].includes(tier) ? tier : 'PRO') as 'BASIC' | 'PRO' | 'ENTERPRISE',
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
      };

      const result = await dbRepo.setPharmacyAnalyticsAccess(pharmacyId, accessData);
      if (!result.success || !result.pharmacy) {
        return res.status(404).json({ success: false, error: result.error || 'Pharmacy not found' });
      }

      return res.json({
        success: true,
        pharmacyId: result.pharmacy.id,
        pharmacyName: result.pharmacy.name,
        analyticsAccess: result.pharmacy.analyticsAccess,
      });
    } catch (err: any) {
      console.error('[API /admin/pharmacy/:id/analytics-access] Error:', err);
      return res.status(500).json({ success: false, error: err.message || 'Failed to update access' });
    }
  }
);

// ==========================================
// 6C. B2B WHOLESALE RESTOCKING MARKETPLACE ("MEDSUPPLY EXCHANGE")
// ==========================================

// 1. Browse certified wholesale listings
app.get('/api/b2b/listings', async (req: Request, res: Response) => {
  try {
    const { category, search, wholesalerId, inStockOnly } = req.query;
    const listings = await dbRepo.getWholesaleListings({
      category: category ? String(category) : undefined,
      drugName: search ? String(search) : undefined,
      wholesalerId: wholesalerId ? String(wholesalerId) : undefined,
      inStockOnly: inStockOnly !== 'false',
    });
    res.json({
      success: true,
      count: listings.length,
      listings,
    });
  } catch (err: any) {
    console.error('[API /b2b/listings] Error:', err);
    res.status(500).json({ success: false, error: err.message || 'Failed to fetch wholesale listings' });
  }
});

// 2. 1-Click stock matcher for out-of-stock retail shelf drug
app.get('/api/b2b/match/:drugName', async (req: Request, res: Response) => {
  try {
    const drugName = decodeURIComponent(String(req.params.drugName || ''));
    if (!drugName) {
      return res.status(400).json({ success: false, error: 'drugName is required' });
    }
    const matches = await dbRepo.matchWholesaleStockForDrug(drugName);
    res.json({
      success: true,
      drugName,
      matchesCount: matches.length,
      matches,
    });
  } catch (err: any) {
    console.error('[API /b2b/match] Error:', err);
    res.status(500).json({ success: false, error: err.message || 'Failed to match wholesale stock' });
  }
});

// 3. Create a Wholesale Purchase Order (PO) with 2% platform fee calculation
app.post('/api/b2b/orders', async (req: Request, res: Response) => {
  try {
    const { pharmacyId, listingId, quantity, deliveryAddress, paymentMethod, statusNotes } = req.body;
    if (!pharmacyId || !listingId || !quantity) {
      return res.status(400).json({ success: false, error: 'pharmacyId, listingId, and quantity are required' });
    }

    const qty = parseInt(String(quantity), 10);
    if (isNaN(qty) || qty <= 0) {
      return res.status(400).json({ success: false, error: 'Quantity must be a positive number' });
    }

    const result = await dbRepo.createWholesalePurchaseOrder({
      pharmacyId: String(pharmacyId),
      listingId: String(listingId),
      quantity: qty,
      deliveryAddress: deliveryAddress ? String(deliveryAddress) : undefined,
      paymentMethod: paymentMethod || 'COD',
      statusNotes: statusNotes ? String(statusNotes) : undefined,
    });

    if (!result.success || !result.order) {
      return res.status(400).json({ success: false, error: result.error || 'Failed to place purchase order' });
    }

    // Instant dispatch notification to wholesaler Telegram channel/bot
    telegramBotService.notifyWholesalePurchaseOrder(result.order).catch((err: any) => {
      console.warn('[B2B Order] Telegram notification to wholesaler failed:', err.message);
    });

    res.json({
      success: true,
      message: `Purchase Order ${result.order.poNumber} submitted successfully to ${result.order.wholesalerName}.`,
      order: result.order,
    });
  } catch (err: any) {
    console.error('[API /b2b/orders POST] Error:', err);
    res.status(500).json({ success: false, error: err.message || 'Error processing purchase order' });
  }
});

// 4. Retrieve Wholesale Purchase Orders (for retail counter or admin)
app.get('/api/b2b/orders', async (req: Request, res: Response) => {
  try {
    const { pharmacyId, wholesalerId, status } = req.query;
    const orders = await dbRepo.getWholesaleOrders({
      pharmacyId: pharmacyId ? String(pharmacyId) : undefined,
      wholesalerId: wholesalerId ? String(wholesalerId) : undefined,
      status: status ? String(status) : undefined,
    });
    res.json({
      success: true,
      count: orders.length,
      orders,
    });
  } catch (err: any) {
    console.error('[API /b2b/orders GET] Error:', err);
    res.status(500).json({ success: false, error: err.message || 'Failed to retrieve orders' });
  }
});

// 5. Update Wholesale Purchase Order status
app.post('/api/b2b/orders/:orderId/status', async (req: Request, res: Response) => {
  try {
    const orderId = String(req.params.orderId);
    const { status, statusNotes } = req.body;
    if (!status) {
      return res.status(400).json({ success: false, error: 'status is required' });
    }

    const result = await dbRepo.updateWholesaleOrderStatus(orderId, status, statusNotes);
    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error || 'Failed to update order status' });
    }
    res.json(result);
  } catch (err: any) {
    console.error('[API /b2b/orders/status] Error:', err);
    res.status(500).json({ success: false, error: err.message || 'Failed to update order status' });
  }
});

// 6. List all certified importers/wholesalers
app.get('/api/b2b/wholesalers', async (_req: Request, res: Response) => {
  try {
    const wholesalers = await dbRepo.getAllWholesalers();
    res.json({
      success: true,
      wholesalers,
    });
  } catch (err: any) {
    console.error('[API /b2b/wholesalers] Error:', err);
    res.status(500).json({ success: false, error: err.message || 'Failed to list wholesalers' });
  }
});

// 7. B2B Platform commission & gross merchandise volume audit (Admin / Finance)
app.get('/api/b2b/invoicing', async (_req: Request, res: Response) => {
  try {
    const report = await dbRepo.getB2BCommissionReport();
    res.json({
      success: true,
      commissionRatePercent: '2.0%',
      ...report,
    });
  } catch (err: any) {
    console.error('[API /b2b/invoicing] Error:', err);
    res.status(500).json({ success: false, error: err.message || 'Failed to fetch B2B commission report' });
  }
});

// ==========================================
// WHOLESALER / IMPORTER SUPPLY STUDIO APIS
// ==========================================
app.post('/api/wholesaler/auth/login', async (req: Request, res: Response) => {
  const { accessKey, key, username } = req.body;
  const keyToUse = String(accessKey || key || username || '').trim();
  if (!keyToUse) {
    return res.status(400).json({ success: false, error: '1-Click Wholesaler Access Key is required' });
  }

  const result = await dbRepo.loginWholesalerWithKey(keyToUse);
  if (!result.success || !result.wholesaler) {
    return res.status(401).json({ success: false, error: result.error || 'Invalid Wholesaler Access Key' });
  }

  res.json({
    success: true,
    token: result.token,
    sessionExpiresAt: result.sessionExpiresAt,
    wholesaler: result.wholesaler,
  });
});

app.get('/api/wholesaler/auth/session', async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '') || String(req.query.token || '');
  if (!token) return res.status(401).json({ success: false, error: 'Not authenticated' });

  const ws = await dbRepo.getWholesalerBySession(token);
  if (!ws) return res.status(401).json({ success: false, error: 'Wholesaler session expired or invalid' });

  res.json({
    success: true,
    wholesaler: ws,
  });
});

app.post('/api/wholesaler/auth/logout', async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '') || String(req.body.token || '');
  if (token) {
    const ws = await dbRepo.getWholesalerBySession(token);
    if (ws) {
      ws.sessionToken = undefined;
      ws.sessionExpiresAt = undefined;
    }
  }
  res.json({ success: true, message: 'Logged out successfully' });
});

app.post('/api/wholesaler/:wholesalerId/listings/add', async (req: Request, res: Response) => {
  try {
    const wholesalerId = String(req.params.wholesalerId);
    const ws = await dbRepo.getWholesalerById(wholesalerId);
    if (!ws) return res.status(404).json({ success: false, error: 'Wholesaler not found' });

    const {
      drugName,
      genericName,
      category,
      wholesalePriceETB,
      retailMspETB,
      minimumOrderQty,
      availableStock,
      batchNumber,
      expiryDate,
      efdaRegistrationNo,
      originCountry,
      deliveryEstimateHours,
    } = req.body;

    if (!drugName || !wholesalePriceETB) {
      return res.status(400).json({ success: false, error: 'Drug name and wholesale price are required' });
    }

    const listing = await dbRepo.addWholesaleListing({
      wholesalerId: ws.id,
      wholesalerName: ws.name,
      wholesalerPhone: ws.phone,
      wholesalerSubCity: ws.subCity,
      drugName: String(drugName).trim(),
      genericName: genericName ? String(genericName).trim() : undefined,
      category: category ? String(category).trim() : 'General Prescription',
      wholesalePriceETB: Number(wholesalePriceETB),
      retailMspETB: retailMspETB ? Number(retailMspETB) : undefined,
      minimumOrderQty: Number(minimumOrderQty) || 5,
      availableStock: Number(availableStock) || 50,
      batchNumber: batchNumber ? String(batchNumber).trim() : `BATCH-${Math.floor(Math.random() * 8999 + 1000)}`,
      expiryDate: expiryDate ? String(expiryDate).trim() : '2027-12-31',
      efdaRegistrationNo: efdaRegistrationNo ? String(efdaRegistrationNo).trim() : ws.efdaWholesaleLicense,
      originCountry: originCountry ? String(originCountry).trim() : 'Ethiopia',
      deliveryEstimateHours: deliveryEstimateHours ? Number(deliveryEstimateHours) : 4,
      isActive: true,
    });

    res.json({ success: true, listing });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Failed to add listing' });
  }
});

app.post('/api/wholesaler/:wholesalerId/listings/batch-import', async (req: Request, res: Response) => {
  try {
    const wholesalerId = String(req.params.wholesalerId);
    const { items } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: 'items array is required' });
    }

    const count = await dbRepo.bulkImportWholesaleListings(wholesalerId, items);
    res.json({ success: true, count });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Failed to import batch listings' });
  }
});

app.post('/api/wholesaler/:wholesalerId/listings/:listingId/toggle', async (req: Request, res: Response) => {
  try {
    const listingId = String(req.params.listingId);
    const listing = await dbRepo.toggleWholesaleListing(listingId);
    if (!listing) return res.status(404).json({ success: false, error: 'Listing not found' });
    res.json({ success: true, listing });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Failed to toggle listing' });
  }
});

app.delete('/api/wholesaler/:wholesalerId/listings/:listingId', async (req: Request, res: Response) => {
  try {
    const listingId = String(req.params.listingId);
    const deleted = await dbRepo.deleteWholesaleListing(listingId);
    res.json({ success: deleted });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Failed to delete listing' });
  }
});

// Admin Wholesaler Provisioning & Management Endpoints
app.post('/api/admin/wholesalers/register', async (req: Request, res: Response) => {
  try {
    const { name, subCity, city, phone, efdaWholesaleLicense, tinNumber, deliveryTerms, minimumOrderValueETB } = req.body;
    if (!name || !phone || !efdaWholesaleLicense) {
      return res.status(400).json({
        success: false,
        error: 'Wholesaler name, contact phone, and EFDA wholesale license are required.',
      });
    }

    const result = await dbRepo.registerWholesaler({
      name: String(name),
      subCity: String(subCity || 'Bole'),
      city: String(city || 'Addis Ababa'),
      phone: String(phone),
      efdaWholesaleLicense: String(efdaWholesaleLicense),
      tinNumber: tinNumber ? String(tinNumber) : undefined,
      deliveryTerms: deliveryTerms ? String(deliveryTerms) : undefined,
      minimumOrderValueETB: minimumOrderValueETB ? Number(minimumOrderValueETB) : undefined,
    });

    if (!result.success || !result.wholesaler) {
      return res.status(400).json({ success: false, error: result.error || 'Failed to register wholesaler' });
    }

    const ws = result.wholesaler;
    const directStudioUrl = `http://localhost:3000/wholesaler/?key=${ws.accessKey}`;
    const telegramLink = `https://t.me/MedFinder_Verifier_bot?start=${ws.id}`;

    res.json({
      success: true,
      message: `Wholesaler ${ws.name} registered and provisioned successfully!`,
      wholesaler: ws,
      credentials: {
        accessKey: ws.accessKey,
        directStudioUrl,
        telegramLink,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Error registering wholesaler' });
  }
});

app.delete('/api/admin/wholesalers/:id', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const deleted = await dbRepo.deleteWholesaler(id);
    res.json({ success: deleted });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Error deleting wholesaler' });
  }
});

// Dedicated Wholesaler Supply Studio PWA direct route
app.get(['/wholesaler', '/wholesaler/setup', '/wholesaler/index.html'], (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, '../public/wholesaler/index.html'));
});

// ==========================================
// 7. TELEGRAM VERIFICATION BOT APIS (CHANNEL B)
// ==========================================
// Webhook & Chat Interaction
app.post('/api/telegram/webhook', async (req: Request, res: Response) => {
  const body = req.body;
  const cb = body.callback_query;
  const chatId = String(cb?.message?.chat?.id || body.message?.chat?.id || body.chatId || 'tg_user_99120');
  const username = cb?.from?.username ? `@${cb.from.username}` : (body.message?.from?.username ? `@${body.message.from.username}` : (body.username || '@pharmacist'));
  const text = cb?.data || body.message?.text || body.text || '';
  const photoUrl = body.photoUrl;
  const documentUrl = body.documentUrl;
  const location = body.message?.location || body.location;

  const response = await telegramBotService.handleIncomingMessage({
    chatId,
    username,
    text,
    photoUrl,
    documentUrl,
    location,
  });

  res.json({ success: true, response });
});

// Interactive Web UI Simulation Endpoint
app.post('/api/telegram/simulate-chat', async (req: Request, res: Response) => {
  const { chatId = 'tg_user_99120', username = '@pharmacist', text, photoUrl, documentUrl, location, botType = 'PHARMACY' } = req.body;
  if (!text && !photoUrl && !location) {
    return res.status(400).json({ success: false, error: 'text, photoUrl, or location is required' });
  }

  const normalizedType = String(botType).toUpperCase() === 'PATIENT' ? 'PATIENT' : 'PHARMACY';
  const response = await telegramBotService.handleIncomingMessage({
    chatId,
    username,
    text,
    photoUrl,
    documentUrl,
    location,
  }, normalizedType);

  res.json({ success: true, response });
});

// List all verification applications for Admin Review Desk
app.get('/api/telegram/applications', async (_req: Request, res: Response) => {
  const applications = await dbRepo.getVerificationApplications();
  res.json({
    success: true,
    applications,
  });
});

// Admin Review Decision (Approve / Reject / Request More Info)
app.post('/api/telegram/applications/:id/review', requireAdminAuth, requirePrivilege('canReviewApplications'), async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const { status, adminNotes, efdaLicenseNumber } = req.body;

  if (!status || !['APPROVED', 'REJECTED', 'INFO_REQUESTED'].includes(status)) {
    return res.status(400).json({ success: false, error: 'Valid status required: APPROVED, REJECTED, INFO_REQUESTED' });
  }

  const reviewResult = await dbRepo.reviewVerificationApplication(id, status, adminNotes, efdaLicenseNumber);
  if (!reviewResult.success || !reviewResult.application) {
    return res.status(404).json({ success: false, error: reviewResult.error || 'Application not found' });
  }

  // Synchronize in-memory DB instance with identical access key
  db.reviewVerificationApplication(id, status, adminNotes, efdaLicenseNumber);
  if (status === 'APPROVED' && reviewResult.application.portalAccessKey) {
    const exactKey = reviewResult.application.portalAccessKey;
    const memApp = db.verificationApplications.find((a) => a.id === id || a.telegramChatId === reviewResult.application!.telegramChatId);
    if (memApp) {
      memApp.portalAccessKey = exactKey;
      memApp.portalUsername = exactKey;
      memApp.portalSetupToken = exactKey;
    }
    if (reviewResult.pharmacy) {
      const memAcc = db.createOrGetPharmacyAccount(reviewResult.pharmacy, reviewResult.application.telegramChatId);
      memAcc.accessKey = exactKey;
      db.pharmacyAccounts.set(exactKey, memAcc);
    }
  }

  // Dispatch live notification back to the pharmacy's Telegram chat in background
  telegramBotService.notifyReviewDecision(
    reviewResult.application.telegramChatId,
    status,
    adminNotes,
    reviewResult.application
  ).catch((err: any) => console.error('[Telegram Notification Error]:', err.message));

  res.json({
    success: true,
    application: reviewResult.application,
    pharmacy: reviewResult.pharmacy,
  });
});

function getMimeTypeFromBuffer(buf: Buffer): string {
  if (buf.length >= 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) {
    return 'application/pdf';
  }
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) {
    return 'image/png';
  }
  if (buf.length >= 3 && buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) {
    return 'image/jpeg';
  }
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  return 'image/jpeg';
}

// Telegram Media Proxy & Stream Endpoint (Channel B Wall Certificates & Photos)
app.get('/api/telegram/media/:fileId', async (req: Request, res: Response) => {
  const fileId = req.params.fileId;
  if (!fileId || typeof fileId !== 'string') {
    return res.status(400).send('Invalid fileId');
  }

  const uploadsDir = path.join(__dirname, '../public/uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  const sanitizedFileId = fileId.replace(/[^a-zA-Z0-9_-]/g, '');
  const cachedJpg = path.join(uploadsDir, `telegram_${sanitizedFileId}.jpg`);

  // 1. Serve cached file if already fetched from Telegram CDN
  if (fs.existsSync(cachedJpg)) {
    const cachedBuf = await fs.promises.readFile(cachedJpg);
    const mime = getMimeTypeFromBuffer(cachedBuf);
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.send(cachedBuf);
  }

  // 2. Fetch fresh from Telegram Cloud via Bot Token
  try {
    const buffer = await telegramBotService.fetchTelegramFileBuffer(fileId);
    if (buffer && buffer.length > 0) {
      await fs.promises.writeFile(cachedJpg, buffer);
      const mime = getMimeTypeFromBuffer(buffer);
      res.setHeader('Content-Type', mime);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.send(buffer);
    }
  } catch (err: any) {
    console.warn(`[Telegram Media] Live download failed for fileId ${fileId}:`, err.message);
  }

  // 3. Fallback: Return honest "Physical Document Not Available" placeholder
  // A private platform MUST NOT auto-generate or synthesize an official government EFDA CoC certificate
  const unavailableSvg = generateDocumentUnavailableSvg(sanitizedFileId);
  const cachedSvg = path.join(uploadsDir, `telegram_${sanitizedFileId}.svg`);
  fs.writeFileSync(cachedSvg, unavailableSvg, 'utf-8');

  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Cache-Control', 'no-cache');
  return res.sendFile(cachedSvg);
});

function generateDocumentUnavailableSvg(mediaId?: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 480" width="100%" height="100%">
    <rect width="800" height="480" fill="#f8fafc"/>
    <rect x="20" y="20" width="760" height="440" rx="16" fill="#ffffff" stroke="#cbd5e1" stroke-width="2" stroke-dasharray="6 4"/>
    <g transform="translate(400, 120)" text-anchor="middle">
      <circle cx="0" cy="0" r="40" fill="#fef2f2"/>
      <path d="M-14,14 L0,-16 L14,14 Z" fill="none" stroke="#ef4444" stroke-width="3" stroke-linejoin="round"/>
      <line x1="0" y1="-4" x2="0" y2="4" stroke="#ef4444" stroke-width="3" stroke-linecap="round"/>
      <circle cx="0" cy="9" r="1.5" fill="#ef4444"/>
    </g>
    <g transform="translate(400, 205)" text-anchor="middle" font-family="'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, sans-serif">
      <text y="0" font-weight="800" font-size="20" fill="#0f172a">PHYSICAL DOCUMENT NOT AVAILABLE</text>
      <text y="28" font-size="13" fill="#64748b">No photograph or document was uploaded, or the Telegram media could not be retrieved.</text>
      <g transform="translate(0, 65)">
        <rect x="-270" y="-18" width="540" height="76" rx="8" fill="#fffbeb" stroke="#fcd34d" stroke-width="1.5"/>
        <text y="6" font-size="12" font-weight="700" fill="#b45309">⚠️ REGULATORY COMPLIANCE WARNING</text>
        <text y="28" font-size="11.5" fill="#92400e">Do NOT approve this premise without inspecting a physical EFDA wall license.</text>
        <text y="46" font-size="11" fill="#78350f">Request applicant to upload their official Certificate of Competence (CoC) via Telegram bot.</text>
      </g>
      ${mediaId ? `<text y="185" font-size="11" font-family="monospace" fill="#94a3b8">Media Reference: ${mediaId}</text>` : ''}
    </g>
  </svg>`;
}

// Real Bot Connection & Status Management (Dual Dedicated Bots)
app.get('/api/telegram/status', (_req: Request, res: Response) => {
  res.json({
    success: true,
    status: telegramBotService.getStatus(),
  });
});

app.post('/api/telegram/connect', requireAdminAuth, requirePrivilege('canManagePolicies'), async (req: Request, res: Response) => {
  const { botToken, botType = 'pharmacy' } = req.body;
  if (!botToken) {
    return res.status(400).json({ success: false, error: 'botToken is required' });
  }

  const normalizedType: 'PHARMACY' | 'PATIENT' = String(botType).toUpperCase() === 'PATIENT' ? 'PATIENT' : 'PHARMACY';
  const result = await telegramBotService.connectBot(botToken, normalizedType);
  res.json({ ...result, botType: normalizedType });
});

app.post('/api/telegram/disconnect', requireAdminAuth, requirePrivilege('canManagePolicies'), (req: Request, res: Response) => {
  const { botType = 'ALL' } = req.body || {};
  let target: 'PHARMACY' | 'PATIENT' | 'ALL' = 'ALL';
  if (String(botType).toUpperCase() === 'PATIENT') target = 'PATIENT';
  else if (String(botType).toUpperCase() === 'PHARMACY') target = 'PHARMACY';

  telegramBotService.disconnectBot(target);
  res.json({ success: true, message: `Telegram bot disconnected (${target})`, disconnectedType: target });
});

// System Health & Status
app.get('/api/health', async (req: Request, res: Response) => {
  const policy = configService.getPolicy();
  const dbConnected = await isPostgresConnected();
  res.json({
    name: 'MedFinder Ethiopia API',
    status: 'ACTIVE',
    version: policy.version,
    database: {
      type: dbConnected ? 'PostgreSQL (PostGIS)' : 'In-Memory (Development)',
      connected: dbConnected,
      postgisEnabled: dbConnected,
    },
    currentFreePromotionUntil: policy.monetization.freePromotionUntil,
    activeMode: policy.monetization.globalMode,
    monthlyPassETB: policy.monetization.pricing.monthlyPassETB,
  });
});

app.get('/miniapp', (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, '../public/miniapp.html'));
});

// Dedicated Regulatory & Admin Portal Routes
app.get(['/admin', '/admin/index.html'], (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, '../public/admin/index.html'));
});

// Dedicated Patient Medicine Finder PWA Routes
app.get(['/find', '/find/index.html', '/search', '/search/index.html'], (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, '../public/find/index.html'));
});

// Public Landing Page
app.get(['/', '/index.html'], (req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

const server = app.listen(port, async () => {
  console.log(`=======================================================`);
  console.log(` MedFinder Ethiopia Server running on http://localhost:${port}`);
  console.log(` Dynamic Free Promotion Ends: ${configService.getPolicy().monetization.freePromotionUntil}`);
  
  const { isPostgres } = await initDatabase();
  if (isPostgres) {
    console.log(` Database: Production PostgreSQL + PostGIS connected & migrations applied!`);
  } else {
    console.log(` Database: Running with In-Memory store (Configure DATABASE_URL to enable PostgreSQL)`);
  }
  console.log(`=======================================================`);
});

// Graceful Shutdown Hooks (SIGTERM & SIGINT)
const gracefulShutdown = async (signal: string) => {
  console.log(`[Server] Received ${signal}. Closing HTTP server and database pool...`);
  server.close(async () => {
    console.log('[Server] HTTP server closed.');
    await closePostgresPool(); // Call pool.end() from db-client.ts
    process.exit(0);
  });
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));


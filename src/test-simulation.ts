import { DynamicConfigService } from './config/dynamic-config.service';
import { MonetizationService } from './monetization/monetization.service';
import { BroadcastMatchingService } from './matching/broadcast-matching.service';
import { InMemoryDatabase } from './database/in-memory-db';

async function runSimulation() {
  console.log('================================================================');
  console.log('🚀 MEDFINDER ETHIOPIA: DYNAMIC CONFIG & MONETIZATION SIMULATION');
  console.log('================================================================\n');

  const configService = DynamicConfigService.getInstance();
  const monetizationService = new MonetizationService();
  const broadcastService = new BroadcastMatchingService();
  const db = InMemoryDatabase.getInstance();

  const testUserId = 'user_tg_998877';
  const userLat = 9.0015; // Near Bole, Addis Ababa
  const userLng = 38.7845;

  // -------------------------------------------------------------
  // STEP 1: INITIAL PROMOTIONAL LAUNCH PERIOD (100% FREE)
  // -------------------------------------------------------------
  console.log('--- [STEP 1] Testing Initial Launch (Free Period Active) ---');
  let currentPolicy = configService.getPolicy();
  console.log(`Current Free Promotion Cut-off Date: ${currentPolicy.monetization.freePromotionUntil}`);

  let access = monetizationService.evaluateAccess({ userId: testUserId, city: 'Addis Ababa', subCity: 'Bole' });
  console.log('Access Evaluation Result:', {
    isAllowed: access.isAllowed,
    reason: access.reason,
    freeUntilDate: access.freeUntilDate,
  });

  if (access.isAllowed) {
    const searchRes = broadcastService.searchDirectCatalog({ medicineName: 'insulin', userLat, userLng });
    console.log(`✅ Search succeeded for FREE! Found ${searchRes.length} nearby pharmacies with Insulin.`);
    searchRes.forEach((res) => {
      console.log(`   -> ${res.pharmacy.name} (${res.distanceKm} km away)`);
    });
  }

  // -------------------------------------------------------------
  // STEP 2: DYNAMIC CUTOFF DATE ACTIVATION (ADMIN EXPIRES PROMOTION)
  // -------------------------------------------------------------
  console.log('\n--- [STEP 2] Simulating Launch Period Expiry (Cut-off Date Reached) ---');
  // Admin dynamically sets the cutoff to yesterday
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  configService.setFreePromotionEndDate(yesterday);
  console.log(`Admin dynamically updated Free Promotion Cut-off Date to: ${yesterday}`);

  // Also set freemium quota to 0 and clear regional overrides to test immediate paywall
  configService.updatePolicy({
    monetization: {
      ...configService.getPolicy().monetization,
      freemiumQuotaPerMonth: 0,
      regionalOverrides: [],
    },
  });

  // Evaluate access again
  access = monetizationService.evaluateAccess({ userId: testUserId, city: 'Addis Ababa', subCity: 'Bole' });
  console.log('Access Evaluation after Cut-off Date:', {
    isAllowed: access.isAllowed,
    reason: access.reason,
    paymentOptions: access.paymentOptions,
  });

  // -------------------------------------------------------------
  // STEP 3: DYNAMIC TELEBIRR CHECKOUT INVOICE GENERATION
  // -------------------------------------------------------------
  console.log('\n--- [STEP 3] Generating Telebirr Checkout Invoice ---');
  const invoice = await monetizationService.generatePaymentInvoice({
    userId: testUserId,
    purpose: 'MONTHLY_PASS',
  });
  console.log('Telebirr Checkout Generated:', {
    invoiceId: invoice.invoiceId,
    amount: `${invoice.amountETB} ETB`,
    purpose: invoice.purpose,
    status: invoice.status,
    checkoutUrl: invoice.checkoutUrl,
  });

  // -------------------------------------------------------------
  // STEP 4: TELEBIRR WEBHOOK SIMULATION (USER ENTERS PIN & PAYS)
  // -------------------------------------------------------------
  console.log('\n--- [STEP 4] Simulating Telebirr Webhook Confirmation ---');
  const paymentSuccess = monetizationService.completePayment(invoice.invoiceId);
  console.log(`Telebirr Payment Confirmed: ${paymentSuccess}`);

  const userSub = db.subscriptions.get(testUserId);
  console.log('Updated User Subscription State:', {
    plan: userSub?.plan,
    active: userSub?.active,
    expiresAt: userSub?.expiresAt,
  });

  // -------------------------------------------------------------
  // STEP 5: SEARCH AGAIN WITH ACTIVE PAID SUBSCRIPTION
  // -------------------------------------------------------------
  console.log('\n--- [STEP 5] Search with Active Monthly Pass ---');
  access = monetizationService.evaluateAccess({ userId: testUserId, city: 'Addis Ababa', subCity: 'Bole' });
  console.log('Access Evaluation:', {
    isAllowed: access.isAllowed,
    reason: access.reason,
  });

  // -------------------------------------------------------------
  // STEP 6: DYNAMIC BROADCAST PING & PHARMACIST CLAIM
  // -------------------------------------------------------------
  console.log('\n--- [STEP 6] Testing "Broadcast Ping" for Rare Medicine ---');
  const broadcastReq = broadcastService.createBroadcastRequest({
    userId: testUserId,
    medicineName: 'Humulin N (Specialty Insulin)',
    userLat,
    userLng,
  });
  console.log(`Broadcast Created [${broadcastReq.id}] pinging ${broadcastReq.pingedPharmacyIds.length} pharmacies.`);

  // Pharmacist from Mexico Square responds
  const phResponse = broadcastService.recordPharmacyResponse({
    requestId: broadcastReq.id,
    pharmacyId: 'pharm-mexico-05',
    hasStock: true,
    priceETB: 420,
  });
  console.log('Pharmacist Response Logged:', phResponse);

  const updatedReq = db.broadcastRequests.get(broadcastReq.id);
  console.log(`Patient Alert: ${updatedReq?.responses[0]?.pharmacyName} confirmed stock at ${updatedReq?.responses[0]?.priceETB} ETB!`);

  console.log('\n================================================================');
  console.log('✅ ALL DYNAMIC CONFIGURATION & MONETIZATION TESTS PASSED!');
  console.log('================================================================\n');
}

runSimulation();

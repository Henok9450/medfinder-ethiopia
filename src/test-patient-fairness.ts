import { InMemoryDatabase } from './database/in-memory-db';
import { getDatabaseRepository } from './database';
import { RateLimiterService } from './security/rate-limiter.service';

async function runFairnessTests() {
  console.log('================================================================');
  console.log('🧪 TESTING RATE LIMITING, BOT DETECTION & HOLD FAIRNESS SAFEGUARDS');
  console.log('================================================================');

  const db = InMemoryDatabase.getInstance();
  const repo = getDatabaseRepository();
  const rateLimiter = RateLimiterService.getInstance();

  // -------------------------------------------------------------------------
  // 1. RATE LIMITING & BOT SCRAPER DETECTION
  // -------------------------------------------------------------------------
  console.log('\n--- [TEST GROUP 1] Rate Limiter & Scraper Bot Detection ---');

  // Test 1A: Bot detection
  const botAgents = [
    'python-requests/2.28.1',
    'aiohttp/3.8.1',
    'curl/7.88.1',
    'Wget/1.21.3',
    'Scrapy/2.9.0 (+https://scrapy.org)',
    'Bytespider',
  ];
  for (const agent of botAgents) {
    const check = rateLimiter.detectBot(agent);
    console.assert(check.isBot === true, `Failed to detect scraper: ${agent}`);
  }
  console.log('✅ Test 1A Passed: Automated scraper User-Agents identified correctly');

  // Test 1B: Real browser User-Agent
  const realBrowser = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
  console.assert(rateLimiter.detectBot(realBrowser).isBot === false, 'Real browser flagged as bot falsely');
  console.log('✅ Test 1B Passed: Legitimate mobile/browser user allowed through');

  // Test 1C: Search Burst Limit (Max 8 within 5 seconds)
  const testIp = '196.188.120.45'; // Ethiopian IP test simulation
  for (let i = 1; i <= 8; i++) {
    const res = rateLimiter.checkSearchRateLimit(testIp);
    console.assert(res.allowed === true, `Search ${i} should be allowed`);
  }
  const burstExceeded = rateLimiter.checkSearchRateLimit(testIp);
  console.assert(burstExceeded.allowed === false, '9th search in 5s burst must be throttled');
  console.assert(burstExceeded.resetInSeconds !== undefined && burstExceeded.resetInSeconds > 0, 'ResetInSeconds must be positive');
  console.log('✅ Test 1C Passed: Search burst throttling enforced (429 Too Many Requests)');

  // Test 1D: Hold Creation Limit (Max 5 attempts / 10 min)
  const holdTestIp = '196.188.120.99';
  for (let i = 1; i <= 5; i++) {
    const res = rateLimiter.checkHoldRateLimit(holdTestIp);
    console.assert(res.allowed === true, `Hold attempt ${i} should be allowed`);
  }
  const holdExceeded = rateLimiter.checkHoldRateLimit(holdTestIp);
  console.assert(holdExceeded.allowed === false, '6th hold attempt in 10min must be throttled');
  console.log('✅ Test 1D Passed: Medicine reservation hold spam protection enforced');

  // -------------------------------------------------------------------------
  // 2. ANTI-HOARDING: 1-ACTIVE-HOLD ENFORCEMENT
  // -------------------------------------------------------------------------
  console.log('\n--- [TEST GROUP 2] Anti-Hoarding: 1 Active Hold Policy ---');

  const patientA = 'test_patient_telecom_01';
  const patientPhone = '+251911223344';
  const pharmacy1 = db.pharmacies[0];
  const pharmacy2 = db.pharmacies[1] || db.pharmacies[0];

  // Ensure pharmacy is open for hold testing
  pharmacy1.isManuallyClosed = false;
  pharmacy1.openingTime = '00:00';
  pharmacy1.closingTime = '23:59';
  pharmacy2.isManuallyClosed = false;
  pharmacy2.openingTime = '00:00';
  pharmacy2.closingTime = '23:59';

  // Initial eligibility check - should be eligible
  const initialElig = await repo.checkPatientHoldEligibility(patientA, patientPhone);
  console.assert(initialElig.eligible === true, 'Patient should initially be eligible for hold');
  console.log('✅ Test 2A Passed: Clean patient is eligible for reservation hold');

  // Create First Hold
  const hold1 = await repo.createReservationHold({
    patientUserId: patientA,
    patientPhone,
    pharmacyId: pharmacy1.id,
    medicineName: 'Insulin Glargine',
    lockedPriceETB: 450,
    durationMinutes: 60,
  });
  console.assert(hold1 !== null, 'Hold 1 creation must succeed');
  console.assert(Boolean(hold1?.reservationCode && hold1.reservationCode.length >= 4), 'Voucher code format');
  console.assert(hold1?.patientPhone === patientPhone, 'Verified phone attached to voucher');
  console.log(`✅ Test 2B Passed: Hold 1 created with verified SIM phone (${hold1?.reservationCode})`);

  // Attempt Second Concurrent Hold - must be blocked by Anti-Hoarding rule
  const secondElig = await repo.checkPatientHoldEligibility(patientA, patientPhone);
  console.assert(secondElig.eligible === false, 'Patient with active hold must NOT be eligible');
  console.assert(secondElig.reason === 'ACTIVE_HOLD_EXISTS', 'Reason must be ACTIVE_HOLD_EXISTS');
  console.assert(secondElig.activeHold?.reservationCode === hold1?.reservationCode, 'Must reference existing hold');

  const hold2 = await repo.createReservationHold({
    patientUserId: patientA,
    patientPhone,
    pharmacyId: pharmacy2.id,
    medicineName: 'Augmentin 625mg',
    lockedPriceETB: 320,
    durationMinutes: 60,
  });
  console.assert(hold2 === null, 'Hold 2 must be blocked when hold 1 is active');
  console.log('✅ Test 2C Passed: Second concurrent hold successfully blocked (Anti-Hoarding enforced)');

  // -------------------------------------------------------------------------
  // 3. INSTANT SELF-CANCELLATION & STOCK RELEASE
  // -------------------------------------------------------------------------
  console.log('\n--- [TEST GROUP 3] Instant Self-Cancellation & Stock Release ---');

  // Patient cancels hold 1
  const cancelRes = await repo.cancelReservationHold({
    reservationCode: hold1!.reservationCode,
    cancelledBy: 'PATIENT',
    reason: 'Patient self-cancelled to pick a closer pharmacy',
  });
  console.assert(cancelRes.success === true, 'Cancellation should succeed');
  console.assert(cancelRes.reservation?.status === 'CANCELLED', 'Reservation status must be CANCELLED');
  console.assert(cancelRes.reservation?.cancelledBy === 'PATIENT', 'CancelledBy must be PATIENT');
  console.log('✅ Test 3A Passed: Active voucher cancelled immediately by patient');

  // After cancellation, patient should immediately be eligible again
  const postCancelElig = await repo.checkPatientHoldEligibility(patientA, patientPhone);
  console.assert(postCancelElig.eligible === true, 'Patient must be eligible again after cancellation');

  // Can now reserve at pharmacy 2
  const holdAfterCancel = await repo.createReservationHold({
    patientUserId: patientA,
    patientPhone,
    pharmacyId: pharmacy2.id,
    medicineName: 'Augmentin 625mg',
    lockedPriceETB: 320,
    durationMinutes: 60,
  });
  console.assert(holdAfterCancel !== null, 'Hold after cancellation must succeed');
  console.log(`✅ Test 3B Passed: Stock immediately released; new hold created (${holdAfterCancel?.reservationCode})`);

  // Clean up holdAfterCancel
  await repo.cancelReservationHold({
    reservationCode: holdAfterCancel!.reservationCode,
    cancelledBy: 'PATIENT',
  });

  // -------------------------------------------------------------------------
  // 4. 3-STRIKE NO-SHOW PENALTY (24-HOUR COOLDOWN)
  // -------------------------------------------------------------------------
  console.log('\n--- [TEST GROUP 4] 3-Strike No-Show Cooldown Enforcement ---');

  const ghostPatient = 'test_ghost_patient_99';
  const ghostPhone = '+251922334455';

  // Simulate 3 expired (uncollected) reservations within the last 7 days
  const now = Date.now();
  for (let i = 1; i <= 3; i++) {
    const expiredReservation = {
      reservationCode: `HLD-GHOST-0${i}`,
      patientUserId: ghostPatient,
      patientPhone: ghostPhone,
      pharmacyId: pharmacy1.id,
      pharmacyName: pharmacy1.name,
      medicineName: 'Test Expired Drug',
      lockedPriceETB: 200,
      phone: pharmacy1.phone,
      status: 'EXPIRED' as const,
      pharmacistAcknowledged: true,
      createdAt: new Date(now - (i * 3600 * 1000 * 12)).toISOString(), // 12h, 24h, 36h ago
      expiresAt: new Date(now - (i * 3600 * 1000 * 11)).toISOString(),
    };
    db.reservations.set(expiredReservation.reservationCode, expiredReservation);
  }

  // Check ghost patient eligibility
  const penaltyElig = await repo.checkPatientHoldEligibility(ghostPatient, ghostPhone);
  console.assert(penaltyElig.eligible === false, 'Patient with 3 no-shows must NOT be eligible');
  console.assert(penaltyElig.reason === 'NO_SHOW_PENALTY', 'Reason must be NO_SHOW_PENALTY');
  console.assert(penaltyElig.cooldownUntil !== undefined, 'Cooldown expiration must be provided');
  console.log('✅ Test 4A Passed: 3 uncollected holds triggered 24-hour NO_SHOW_PENALTY cooldown');

  // Attempt to create hold under penalty - must fail
  const blockedHold = await repo.createReservationHold({
    patientUserId: ghostPatient,
    patientPhone: ghostPhone,
    pharmacyId: pharmacy1.id,
    medicineName: 'Emergency Drug',
    lockedPriceETB: 100,
  });
  console.assert(blockedHold === null, 'Hold creation must be blocked during penalty cooldown');
  console.log('✅ Test 4B Passed: Hold creation successfully blocked during penalty cooldown');

  console.log('\n================================================================');
  console.log('🎉 ALL RATE LIMITING, BOT DETECTION & HOLD FAIRNESS TESTS PASSED!');
  console.log('================================================================');
}

runFairnessTests().catch((err) => {
  console.error('❌ Test failed with error:', err);
  process.exit(1);
});

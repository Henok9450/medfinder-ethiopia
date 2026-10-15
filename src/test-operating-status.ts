import { InMemoryDatabase, evaluatePharmacyOperatingStatus } from './database/in-memory-db';

console.log('================================================================');
console.log('🧪 TESTING PHARMACY OPERATING STATUS & SMART HOLD TRUNCATION');
console.log('================================================================');

const db = InMemoryDatabase.getInstance();
const p1 = db.pharmacies[0];

// Test 1: 24/7 Night Duty
p1.is24Hours = true;
const status24 = evaluatePharmacyOperatingStatus(p1);
console.assert(status24.isOpen === true, '24/7 should be open');
console.assert(status24.is24Hours === true, '24/7 flag');
console.assert(status24.canAcceptHold === true, '24/7 can accept hold');
console.assert(status24.maxHoldMinutes === 60, '24/7 full 60m hold');
console.log('✅ Test 1 Passed: 24/7 duty');

// Test 2: Standard open daytime (14:00 EAT)
p1.is24Hours = false;
p1.openingTime = '08:00';
p1.closingTime = '22:00';
p1.isManuallyClosed = false;
// 14:00 EAT is 11:00 UTC
const noonUtc = new Date('2026-10-15T11:00:00.000Z');
const statusOpen = evaluatePharmacyOperatingStatus(p1, noonUtc);
console.assert(statusOpen.isOpen === true, 'Should be open at 14:00 EAT');
console.assert(statusOpen.canAcceptHold === true, 'Should accept hold');
console.assert(statusOpen.maxHoldMinutes === 60, 'Full 60m when plenty time remains');
console.log('✅ Test 2 Passed: Open daytime');

// Test 3: Truncation 15 minutes before closing (21:45 EAT for 22:00 close)
// 21:45 EAT is 18:45 UTC
const nearCloseUtc = new Date('2026-10-15T18:45:00.000Z');
const statusTrunc = evaluatePharmacyOperatingStatus(p1, nearCloseUtc);
console.assert(statusTrunc.isOpen === true, 'Should be open 15m before close');
console.assert(statusTrunc.canAcceptHold === true, 'Can accept hold');
console.assert(statusTrunc.maxHoldMinutes === 15, 'Truncated to 15m, got: ' + statusTrunc.maxHoldMinutes);
console.log('✅ Test 3 Passed: Truncated hold to 15 minutes before closing');

// Test 4: Closed after hours (23:00 EAT -> 20:00 UTC)
const afterCloseUtc = new Date('2026-10-15T20:00:00.000Z');
const statusClosed = evaluatePharmacyOperatingStatus(p1, afterCloseUtc);
console.assert(statusClosed.isOpen === false, 'Should be closed at 23:00');
console.assert(statusClosed.canAcceptHold === false, 'Cannot accept hold');
console.assert(statusClosed.reason === 'AFTER_HOURS', 'Reason AFTER_HOURS');
console.log('✅ Test 4 Passed: Closed after hours');

// Test 5: Manually paused during open hours
p1.isManuallyClosed = true;
const statusManual = evaluatePharmacyOperatingStatus(p1, noonUtc);
console.assert(statusManual.isOpen === false, 'Should be closed when manually closed');
console.assert(statusManual.canAcceptHold === false, 'Cannot accept hold');
console.assert(statusManual.reason === 'MANUALLY_CLOSED', 'Reason MANUALLY_CLOSED');
console.log('✅ Test 5 Passed: 1-Tap Manual Break Pause');

// Test 6: Overnight shift (20:00 to 06:00 EAT), evaluated at 02:00 EAT (23:00 UTC prev day)
p1.isManuallyClosed = false;
p1.openingTime = '20:00';
p1.closingTime = '06:00';
const overnightUtc = new Date('2026-10-15T23:00:00.000Z'); // 02:00 EAT
const statusOvernight = evaluatePharmacyOperatingStatus(p1, overnightUtc);
console.assert(statusOvernight.isOpen === true, 'Should be open during overnight shift');
console.log('✅ Test 6 Passed: Overnight shift evaluation');

// Test 7: DB update method
const updated = db.updatePharmacyOperatingStatus(p1.id, {
  is24Hours: true,
  openingTime: '00:00',
  closingTime: '23:59',
  isManuallyClosed: false
});
console.assert(updated.success === true && updated.pharmacy?.is24Hours === true, 'DB update reflected');
console.log('✅ Test 7 Passed: InMemoryDatabase update method');

// Test 8: Reservation hold rejection when closed
p1.is24Hours = false;
p1.isManuallyClosed = true;
const closedOp = evaluatePharmacyOperatingStatus(p1);
console.assert(closedOp.canAcceptHold === false, 'closedOp should not accept hold');
console.log('✅ Test 8 Passed: Hold creation prevented on closed store');

console.log('================================================================');
console.log('🎉 ALL 8 OPERATING STATUS & SMART HOLD TRUNCATION TESTS PASSED!');
console.log('================================================================');


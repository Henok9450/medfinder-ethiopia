import { TelegramVerificationBotService } from './verification/telegram-verification-bot.service';
import { InMemoryDatabase } from './database/in-memory-db';

async function testLicensePhotoFlow() {
  console.log('================================================================');
  console.log('🧪 TEST: PHARMACY VERIFICATION BOT - LICENSE PHOTO UPLOAD STEP');
  console.log('================================================================\n');

  const botService = new TelegramVerificationBotService();
  const db = InMemoryDatabase.getInstance();
  const testChatId = 'tg_test_license_upload_' + Date.now();

  // Step 0: Start verification
  console.log('--- Step 0: Start /verify ---');
  let res = await botService.handleIncomingMessage({
    chatId: testChatId,
    text: '/verify',
  }, 'PHARMACY');
  console.log(`[Bot]: ${res.replyText.substring(0, 80)}...`);
  if (res.sessionStep !== 'LANGUAGE') throw new Error(`Expected LANGUAGE step, got ${res.sessionStep}`);

  // Step 1: Language Selection
  console.log('\n--- Step 1: Choose Language ---');
  res = await botService.handleIncomingMessage({
    chatId: testChatId,
    text: '1. አማርኛ (Amharic)',
  }, 'PHARMACY');
  console.log(`[Bot]: ${res.replyText.substring(0, 80)}...`);
  if (res.sessionStep !== 'PHARMACY_NAME') throw new Error(`Expected PHARMACY_NAME step, got ${res.sessionStep}`);

  // Step 2: Pharmacy Name
  console.log('\n--- Step 2: Enter Pharmacy Name ---');
  res = await botService.handleIncomingMessage({
    chatId: testChatId,
    text: 'Selam Central Pharmacy',
  }, 'PHARMACY');
  console.log(`[Bot]: ${res.replyText.substring(0, 80)}...`);
  if (res.sessionStep !== 'LOCATION_GPS') throw new Error(`Expected LOCATION_GPS step, got ${res.sessionStep}`);

  // Step 3: Location GPS
  console.log('\n--- Step 3: Share GPS ---');
  res = await botService.handleIncomingMessage({
    chatId: testChatId,
    text: '📍 Share Current GPS Location',
    location: { latitude: 9.0015, longitude: 38.7845 },
  }, 'PHARMACY');
  console.log(`[Bot]: ${res.replyText.substring(0, 80)}...`);
  if (res.sessionStep !== 'PHONE') throw new Error(`Expected PHONE step, got ${res.sessionStep}`);

  // Step 4: Phone Number
  console.log('\n--- Step 4: Enter Phone ---');
  res = await botService.handleIncomingMessage({
    chatId: testChatId,
    text: '+251911445566',
  }, 'PHARMACY');
  console.log(`[Bot]: ${res.replyText.substring(0, 80)}...`);
  if (res.sessionStep !== 'PHARMACIST_INFO') throw new Error(`Expected PHARMACIST_INFO step, got ${res.sessionStep}`);

  // Step 5: Pharmacist Info
  console.log('\n--- Step 5: Enter Pharmacist Info ---');
  res = await botService.handleIncomingMessage({
    chatId: testChatId,
    text: 'Hanna Bekele - EPA-RPH-2024-3321',
  }, 'PHARMACY');
  console.log(`[Bot]: ${res.replyText.substring(0, 80)}...`);
  if (res.sessionStep !== 'EFDA_LICENSE') throw new Error(`Expected EFDA_LICENSE step, got ${res.sessionStep}`);

  // Step 6: Enter EFDA License Number
  console.log('\n--- Step 6: Enter EFDA License Number ---');
  res = await botService.handleIncomingMessage({
    chatId: testChatId,
    text: 'EFDA/PH/AA/2024/7742',
  }, 'PHARMACY');
  console.log(`[Bot]:\n${res.replyText}\n`);

  // VERIFICATION OF BUG FIX:
  // The bot MUST transition to LICENSE_PHOTO step and explicitly ask to upload the photo!
  if (res.sessionStep !== 'LICENSE_PHOTO') {
    throw new Error(`FAIL: Expected bot to be at LICENSE_PHOTO step, but got ${res.sessionStep}`);
  }
  if (!res.replyText.includes('የEFDA የብቃት ማረጋገጫ (CoC) ፈቃድ ፎቶ') && !res.replyText.includes('Certificate of Competence')) {
    throw new Error('FAIL: Bot prompt does not mention uploading EFDA CoC license photo');
  }
  console.log('✅ Bot correctly prompted for license picture upload!');

  // Step 7: Upload License Picture
  console.log('\n--- Step 7: Upload License Picture (Photo Attached) ---');
  const mockPhotoUrl = '/api/telegram/media/AgACAgQAAxkBAAICAAFmcMockCertFileId';
  res = await botService.handleIncomingMessage({
    chatId: testChatId,
    photoUrl: mockPhotoUrl,
    text: '[Wall Certificate Photo Uploaded]',
  }, 'PHARMACY');
  console.log(`[Bot]:\n${res.replyText}\n`);

  if (res.sessionStep !== 'TIN_NUMBER') {
    throw new Error(`Expected TIN_NUMBER step, got ${res.sessionStep}`);
  }
  if (!res.replyText.includes('ተቀብለናል') && !res.replyText.includes('received')) {
    throw new Error('Expected acknowledgment of license photo upload');
  }
  console.log('✅ Bot successfully received and acknowledged license photo upload!');

  // Step 8: Enter TIN Number
  console.log('\n--- Step 8: Enter TIN Number ---');
  res = await botService.handleIncomingMessage({
    chatId: testChatId,
    text: 'TIN-0099887766',
  }, 'PHARMACY');
  console.log(`[Bot Summary]:\n${res.replyText}\n`);

  if (res.sessionStep !== 'CONFIRM') throw new Error(`Expected CONFIRM step, got ${res.sessionStep}`);
  if (!res.replyText.includes('የፈቃድ ሰነድ ፎቶ') && !res.replyText.includes('License Photo')) {
    throw new Error('Summary does not mention license photo status');
  }

  // Step 9: Confirm Submission
  console.log('\n--- Step 9: Confirm Submission ---');
  res = await botService.handleIncomingMessage({
    chatId: testChatId,
    text: 'አረጋግጥ',
  }, 'PHARMACY');
  console.log(`[Bot Submission Response]:\n${res.replyText.substring(0, 150)}...\n`);

  // Verify application record in database
  const createdApp = db.verificationApplications.find(a => a.telegramChatId === testChatId);
  if (!createdApp) throw new Error('Application was not saved in database');
  console.log('Saved Application Dossier:');
  console.log(`  ID: ${createdApp.id}`);
  console.log(`  Pharmacy: ${createdApp.pharmacyName}`);
  console.log(`  EFDA License No: ${createdApp.efdaLicenseNumber}`);
  console.log(`  EFDA Document URL: ${createdApp.efdaDocUrl}`);
  console.log(`  Status: ${createdApp.status}`);

  if (createdApp.efdaDocUrl !== mockPhotoUrl) {
    throw new Error(`Expected efdaDocUrl to be ${mockPhotoUrl}, got ${createdApp.efdaDocUrl}`);
  }

  console.log('\n================================================================');
  console.log('🎉 LICENSE PICTURE UPLOAD STEP TEST PASSED 100% SUCCESSFULLY!');
  console.log('================================================================');
  process.exit(0);
}

testLicensePhotoFlow().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});

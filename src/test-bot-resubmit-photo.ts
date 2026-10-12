import { InMemoryDatabase } from './database/in-memory-db';
import { getDatabaseRepository } from './database';
import { TelegramVerificationBotService } from './verification/telegram-verification-bot.service';

async function testResubmitNewPhoto() {
  console.log('================================================================');
  console.log('🧪 TEST: COMPLIANCE OFFICER REQUESTS INFO & PHARMACY UPLOADS NEW PHOTO');
  console.log('================================================================\n');

  const db = InMemoryDatabase.getInstance();
  const repo = getDatabaseRepository();
  const botService = new TelegramVerificationBotService();

  const chatId = '998877661';
  const username = '@TestPharmacist';

  // 1. Pharmacist registers initially
  console.log('--- Step 1: Pharmacist initial registration ---');
  await botService.handleIncomingMessage({ chatId, username, text: '/verify' }, 'PHARMACY');
  await botService.handleIncomingMessage({ chatId, username, text: '1. አማርኛ' }, 'PHARMACY');
  await botService.handleIncomingMessage({ chatId, username, text: 'Bole Meds Pharmacy' }, 'PHARMACY');
  await botService.handleIncomingMessage({ chatId, username, text: '📍 Bole', location: { latitude: 9.001, longitude: 38.784 } }, 'PHARMACY');
  await botService.handleIncomingMessage({ chatId, username, text: '+251911998877' }, 'PHARMACY');
  await botService.handleIncomingMessage({ chatId, username, text: 'Dr. Tesfaye - EPA-1234' }, 'PHARMACY');
  await botService.handleIncomingMessage({ chatId, username, text: 'EFDA/PH/AA/2024/9999' }, 'PHARMACY');
  // Upload blurry initial photo
  await botService.handleIncomingMessage({ 
    chatId, 
    username, 
    text: '[Old Blurry Photo]', 
    photoUrl: '/api/telegram/media/AgAC_OldBlurryPhoto_111' 
  }, 'PHARMACY');
  await botService.handleIncomingMessage({ chatId, username, text: 'TIN-1122334455' }, 'PHARMACY');
  const submitRes = await botService.handleIncomingMessage({ chatId, username, text: 'Confirm' }, 'PHARMACY');
  console.log('Submitted initial application.');

  const apps = await repo.getVerificationApplications();
  const targetApp = apps.find((a) => a.telegramChatId === chatId);
  if (!targetApp) throw new Error('FAIL: Target app not found after submission');
  console.log(`Found application: ${targetApp.id}, status: ${targetApp.status}, docUrl: ${targetApp.efdaDocUrl}`);

  if (targetApp.efdaDocUrl !== '/api/telegram/media/AgAC_OldBlurryPhoto_111') {
    throw new Error('FAIL: Initial photo URL was not saved');
  }

  // 2. Compliance officer requests clearer photo
  console.log('\n--- Step 2: Officer marks INFO_REQUESTED (Blurry Photo) ---');
  const reviewRes = await repo.reviewVerificationApplication(
    targetApp.id, 
    'INFO_REQUESTED', 
    'Uploaded Certificate of Competence (CoC) photo is blurry. Please upload a clear photo showing the seal and license number clearly.'
  );
  db.reviewVerificationApplication(
    targetApp.id, 
    'INFO_REQUESTED', 
    'Uploaded Certificate of Competence (CoC) photo is blurry. Please upload a clear photo showing the seal and license number clearly.'
  );
  await botService.notifyReviewDecision(
    chatId, 
    'INFO_REQUESTED', 
    'Uploaded Certificate of Competence (CoC) photo is blurry. Please upload a clear photo showing the seal and license number clearly.',
    reviewRes.application
  );

  console.log('Officer request dispatched. Application status is now INFO_REQUESTED.');

  // 3. Pharmacist taps "📸 አዲስ ፎቶ ላክ (Send Photo)" button in bot
  console.log('\n--- Step 3: Pharmacist clicks "📸 አዲስ ፎቶ ላክ" ---');
  const tapReply = await botService.handleIncomingMessage({
    chatId,
    username,
    text: '📸 አዲስ ፎቶ ላክ (Send Photo)',
  }, 'PHARMACY');
  console.log('[Bot reply to button tap]:', tapReply.replyText);

  if (!tapReply.replyText.includes('የEFDA የብቃት ማረጋገጫ') && !tapReply.replyText.includes('ፎቶ አያይዘው')) {
    throw new Error('FAIL: Bot did not prompt for photo attachment when button was tapped');
  }

  // 4. Pharmacist uploads new clear photo
  console.log('\n--- Step 4: Pharmacist uploads new high-res photo ---');
  const newPhotoUrl = '/api/telegram/media/AgAC_NewCrispPhoto_999';
  const uploadReply = await botService.handleIncomingMessage({
    chatId,
    username,
    text: '[Wall Certificate Photo Uploaded]',
    photoUrl: newPhotoUrl,
  }, 'PHARMACY');
  console.log('[Bot reply to new photo]:', uploadReply.replyText);

  // 5. Verify the application record has been updated
  console.log('\n--- Step 5: Verification of updated application record ---');
  const updatedApps = await repo.getVerificationApplications();
  const refreshedApp = updatedApps.find((a) => a.id === targetApp.id);
  const inMemRefreshed = db.verificationApplications.find((a) => a.id === targetApp.id);

  console.log(`Refreshed App in Repo: status = ${refreshedApp?.status}, efdaDocUrl = ${refreshedApp?.efdaDocUrl}`);
  console.log(`Refreshed App in DB:   status = ${inMemRefreshed?.status}, efdaDocUrl = ${inMemRefreshed?.efdaDocUrl}`);

  if (refreshedApp?.status !== 'RESUBMITTED') {
    throw new Error(`FAIL: Status is ${refreshedApp?.status}, expected RESUBMITTED`);
  }
  if (refreshedApp?.efdaDocUrl !== newPhotoUrl) {
    throw new Error(`FAIL: efdaDocUrl is ${refreshedApp?.efdaDocUrl}, expected ${newPhotoUrl}`);
  }
  if (inMemRefreshed?.efdaDocUrl !== newPhotoUrl) {
    throw new Error(`FAIL: in-memory efdaDocUrl is ${inMemRefreshed?.efdaDocUrl}, expected ${newPhotoUrl}`);
  }

  console.log('\n================================================================');
  console.log('🎉 RESUBMIT PHOTO DISPLAY TEST PASSED 100% SUCCESSFULLY!');
  console.log('================================================================');
  process.exit(0);
}

testResubmitNewPhoto().catch((err) => {
  console.error('\n❌ TEST FAILED:', err);
  process.exit(1);
});

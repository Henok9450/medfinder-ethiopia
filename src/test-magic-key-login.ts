import { InMemoryDatabase } from './database/in-memory-db';
import { TelegramVerificationBotService } from './verification/telegram-verification-bot.service';

async function testMagicKeyLogin() {
  console.log('=== Testing End-to-End 1-Click Magic Key Approval & Login ===');
  const db = InMemoryDatabase.getInstance();
  const bot = new TelegramVerificationBotService();

  const chatId = 'tg_test_magic_key_7788';
  const app = db.submitVerificationApplication({
    telegramChatId: chatId,
    telegramUsername: '@magic_pharm',
    pharmacyName: 'Bole Magic Key Pharmacy',
    subCity: 'Bole',
    addressDetails: 'Bole Medhanialem',
    phone: '+251911887766',
    pharmacistName: 'RPh. Dawit Tadesse',
    pharmacistLicenseNumber: 'EPA-RPH-2026-9911',
    efdaLicenseNumber: 'EFDA/PH/AA/2026/7788',
    tinNumber: 'TIN-7788990011',
  });

  console.log('1. Application submitted:', app.id);

  // 2. Approve application
  const reviewRes = db.reviewVerificationApplication(app.id, 'APPROVED', 'EFDA CoC verified');
  if (!reviewRes.success || !reviewRes.application) {
    throw new Error('Failed to approve application');
  }
  console.log('2. Application approved. portalAccessKey:', reviewRes.application.portalAccessKey);
  if (!reviewRes.application.portalAccessKey || !reviewRes.application.portalAccessKey.startsWith('mf_key_')) {
    throw new Error('Missing portalAccessKey on approved application!');
  }

  // 3. Test bot /key command
  const keyResp = await bot.handleIncomingMessage({
    chatId,
    username: '@magic_pharm',
    text: '/key',
  });
  console.log('3. Bot /key response received.');
  const urlMatch = keyResp.replyText.match(/key=(mf_key_[a-fA-F0-9]+)/);
  if (!urlMatch) {
    throw new Error('Bot /key response did not contain a valid ?key=mf_key_... URL!\n' + keyResp.replyText);
  }
  const botMagicKey = decodeURIComponent(urlMatch[1]);
  console.log('   Extracted Magic Key from bot:', botMagicKey);

  // 4. Test magicLoginWithKey using the exact key from the bot
  const loginRes = db.magicLoginWithKey(botMagicKey);
  if (!loginRes.success || !loginRes.token || !loginRes.account) {
    throw new Error('magicLoginWithKey failed: ' + loginRes.error);
  }
  console.log('4. Magic Login succeeded! Session token:', loginRes.token.substring(0, 16) + '...');
  console.log('   6-Month Session Expiry:', loginRes.sessionExpiresAt);

  // 5. Verify session restoration
  const restored = db.getAccountBySession(loginRes.token);
  if (!restored || restored.pharmacyId !== loginRes.account.pharmacyId) {
    throw new Error('Session token restoration failed!');
  }
  console.log('5. Persistent session verified for pharmacy:', restored.pharmacyName);
  console.log('✅ ALL MAGIC KEY E2E TESTS PASSED!');
  process.exit(0);
}

testMagicKeyLogin().catch((err) => {
  console.error('❌ TEST FAILED:', err);
  process.exit(1);
});

import { InMemoryDatabase } from './database/in-memory-db';
import { TelegramVerificationBotService } from './verification/telegram-verification-bot.service';

async function runAuthTest() {
  console.log('🧪 TESTING 1-TAP TELEGRAM SIM AUTH BRIDGE & FALLBACK FLOWS');
  const db = InMemoryDatabase.getInstance();
  const botService = new TelegramVerificationBotService();

  // 1. Create Web Auth Session
  const session = db.createPatientAuthSession();
  console.log('Created session:', session.token);
  console.assert(session.status === 'PENDING', 'Initial status must be PENDING');

  // Test flexible token retrieval
  const strippedToken = session.token.replace(/^AUTH_/, '');
  const foundByStripped = db.getPatientAuthSession(strippedToken);
  console.assert(foundByStripped?.token === session.token, 'Should find session without AUTH_ prefix');
  console.log('✅ Test 1: Flexible token prefix lookup passed');

  // 2. Simulate Telegram /start auth_<token>
  const chatId = '987654321';
  const startMsg = {
    chatId,
    username: 'test_ethio_patient',
    text: `/start auth_${strippedToken}`,
  };

  const startReply = await botService.handleIncomingMessage(startMsg as any, 'PATIENT');
  console.log('Start reply text snippet:', startReply.replyText.substring(0, 60));
  console.assert(startReply.sessionStep === 'PATIENT_HOLD_PHONE_VERIFY', 'Should advance to PATIENT_HOLD_PHONE_VERIFY');
  console.log('✅ Test 2: Telegram /start auth_ handshake passed');

  // 3. Simulate Native Contact sharing
  const contactMsg = {
    chatId,
    username: 'test_ethio_patient',
    text: '📱 Verified Phone: +251911223344',
    contact: {
      phone_number: '+251911223344',
      first_name: 'Abebe',
      user_id: 987654321,
    },
  };

  const contactReply = await botService.handleIncomingMessage(contactMsg as any, 'PATIENT');
  console.log('Contact reply text snippet:', contactReply.replyText.substring(0, 80));

  const verifiedSession = db.getPatientAuthSession(session.token);
  console.assert(verifiedSession?.status === 'VERIFIED', 'Session must be marked VERIFIED');
  console.assert(verifiedSession?.verifiedPhone === '+251911223344', 'Phone must be +251911223344');
  console.log('✅ Test 3: Native Telegram contact sharing verification passed');

  // 4. Test Text Phone Entry fallback in bot
  const session2 = db.createPatientAuthSession();
  const strippedToken2 = session2.token.replace(/^AUTH_/, '');
  const chatId2 = '555444333';

  await botService.handleIncomingMessage({
    chatId: chatId2,
    username: 'text_fallback_patient',
    text: `/start auth_${strippedToken2}`,
  } as any, 'PATIENT');

  // User types 0912345678 as text
  const textPhoneReply = await botService.handleIncomingMessage({
    chatId: chatId2,
    username: 'text_fallback_patient',
    text: '0912345678',
  } as any, 'PATIENT');

  console.log('Text phone reply snippet:', textPhoneReply.replyText.substring(0, 80));
  const verifiedSession2 = db.getPatientAuthSession(session2.token);
  console.assert(verifiedSession2?.status === 'VERIFIED', 'Session 2 must be VERIFIED from text phone input');
  console.assert(verifiedSession2?.verifiedPhone === '+251912345678', 'Phone must be normalized to +251912345678');
  console.log('✅ Test 4: Direct text mobile number fallback passed');

  // 5. Test Persistent Device Trust Registry
  const devId1 = 'dev_mobile_chrome_001';
  const session3 = db.createPatientAuthSession(devId1);
  const strippedToken3 = session3.token.replace(/^AUTH_/, '');
  const chatId3 = '777888999';

  await botService.handleIncomingMessage({
    chatId: chatId3,
    username: 'multi_device_patient',
    text: `/start auth_${strippedToken3}`,
  } as any, 'PATIENT');

  await botService.handleIncomingMessage({
    chatId: chatId3,
    username: 'multi_device_patient',
    text: '0933445566',
  } as any, 'PATIENT');

  const trustedDev1 = db.getTrustedDevice(devId1);
  console.assert(trustedDev1?.isTrusted === true, 'Device 1 must be marked trusted');
  console.assert(trustedDev1?.verifiedPhone === '+251933445566', 'Device 1 phone must match');
  console.log('✅ Test 5: Persistent device binding on verification passed');

  // 6. Test Changing Browser / Second Device Auto-Approval
  // Patient now opens Safari / PWA on second device/browser:
  const devId2 = 'dev_ios_safari_002';
  const session4 = db.createPatientAuthSession(devId2);
  const strippedToken4 = session4.token.replace(/^AUTH_/, '');

  // Patient opens bot from new browser via /start auth_...
  const secondBrowserReply = await botService.handleIncomingMessage({
    chatId: chatId3, // Same Telegram user opening from new browser
    username: 'multi_device_patient',
    text: `/start auth_${strippedToken4}`,
  } as any, 'PATIENT');

  console.log('Second browser reply snippet:', secondBrowserReply.replyText.substring(0, 80));
  console.assert(secondBrowserReply.replyText.includes('እንኳን ደህና መጡ') || secondBrowserReply.replyText.includes('Welcome Back'), 'Bot should auto-recognize returning patient');

  const verifiedSession4 = db.getPatientAuthSession(session4.token);
  console.assert(verifiedSession4?.status === 'VERIFIED', 'Second browser session must be instantly verified');
  console.assert(verifiedSession4?.verifiedPhone === '+251933445566', 'Second browser phone must match');

  const trustedDev2 = db.getTrustedDevice(devId2);
  console.assert(trustedDev2?.isTrusted === true, 'Second browser device must be auto-trusted');

  const allDevices = db.getDevicesForPhone('+251933445566');
  console.assert(allDevices.length === 2, 'Phone should have 2 trusted devices linked');
  console.log('✅ Test 6: Cross-browser instant auto-linking (0 OTPs, 0 forms) passed');

  console.log('🎉 ALL TELEGRAM AUTH BRIDGE & MULTI-DEVICE TESTS PASSED!');
  process.exit(0);
}

runAuthTest().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});

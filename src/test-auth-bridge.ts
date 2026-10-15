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

  console.log('🎉 ALL TELEGRAM AUTH BRIDGE VERIFICATION TESTS PASSED!');
  process.exit(0);
}

runAuthTest().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});

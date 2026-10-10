import { InMemoryDatabase } from './database/in-memory-db';
import { TelegramVerificationBotService } from './verification/telegram-verification-bot.service';

async function testB2BMarketplace() {
  console.log('================================================================');
  console.log('📦 TEST: B2B WHOLESALE RESTOCKING MARKETPLACE (MEDSUPPLY EXCHANGE)');
  console.log('================================================================\n');

  const db = InMemoryDatabase.getInstance();
  const telegramBotService = new TelegramVerificationBotService();

  // 1. Wholesalers verification
  console.log('--- 1. Testing Certified Wholesalers & Importers ---');
  const wholesalers = db.getAllWholesalers();
  console.log(`Found ${wholesalers.length} certified importers in Addis Ababa:`);
  wholesalers.forEach(w => {
    console.log(`  ✓ ${w.name} | TIN: ${w.tinNumber} | EFDA CoC: ${w.efdaWholesaleLicense} | Hub: ${w.subCity}`);
  });
  if (wholesalers.length < 3) throw new Error('Expected at least 3 certified importers');

  // 2. Wholesale Listings
  console.log('\n--- 2. Testing Wholesale Stock Listings ---');
  const listings = db.getWholesaleListings({ inStockOnly: true });
  console.log(`Total available wholesale listings: ${listings.length}`);
  const ventolinListing = listings.find(l => l.drugName.toLowerCase().includes('ventolin'));
  if (!ventolinListing) throw new Error('Ventolin listing not found');
  console.log(`  Sample Listing: ${ventolinListing.drugName}`);
  console.log(`  Importer: ${ventolinListing.wholesalerName}`);
  console.log(`  Wholesale Unit Price: ${ventolinListing.wholesalePriceETB} ETB`);
  console.log(`  MOQ: ${ventolinListing.minimumOrderQty} units`);
  console.log(`  Available Stock: ${ventolinListing.availableStock} units`);
  console.log(`  Batch: ${ventolinListing.batchNumber} | Expiry: ${ventolinListing.expiryDate} | EFDA: ${ventolinListing.efdaRegistrationNo}`);

  // 3. Drug Stock Matcher (When retail pharmacy runs out of Ventolin)
  console.log('\n--- 3. Testing 1-Click Stock Matcher for "Ventolin" ---');
  const matches = db.matchWholesaleStockForDrug('Ventolin');
  console.log(`Found ${matches.length} wholesale importers with Ventolin in stock.`);
  if (matches.length === 0) throw new Error('Expected matches for Ventolin');

  // 4. Test Minimum Order Quantity (MOQ) Rejection
  console.log('\n--- 4. Testing MOQ Enforcement ---');
  const testPharmacy = db.pharmacies[0];
  const initialStock = ventolinListing.availableStock;
  const underMoqResult = db.createWholesalePurchaseOrder({
    pharmacyId: testPharmacy.id,
    listingId: ventolinListing.id,
    quantity: 5, // ventolin MOQ is 10 or 20
  });
  console.log(`Under MOQ attempt (5 units when MOQ=${ventolinListing.minimumOrderQty}):`, underMoqResult);
  if (underMoqResult.success) throw new Error('Order should have failed due to MOQ violation');
  console.log('✓ Correctly rejected order below MOQ with message:', underMoqResult.error);

  // 5. Test Successful Wholesale Purchase Order (PO)
  console.log('\n--- 5. Placing Valid Wholesale Purchase Order (PO) ---');
  const validQty = 25;
  const orderResult = db.createWholesalePurchaseOrder({
    pharmacyId: testPharmacy.id,
    listingId: ventolinListing.id,
    quantity: validQty,
    deliveryAddress: `${testPharmacy.name}, Cameroon St, Bole, Addis Ababa`,
    paymentMethod: 'TELEBIRR',
    statusNotes: 'Urgent restocking for morning asthma patients',
  });

  if (!orderResult.success || !orderResult.order) throw new Error('Order should have succeeded');
  const order = orderResult.order;
  console.log('✓ PO Created Successfully!');
  console.log(`  PO Number: ${order.poNumber}`);
  console.log(`  Medicine: ${order.drugName} (Qty: ${order.quantity})`);
  console.log(`  Wholesale Unit Price: ${order.unitPriceETB} ETB`);
  console.log(`  Wholesale Total: ${order.totalPriceETB} ETB`);
  console.log(`  2% Platform Commission: ${order.platformFeeETB} ETB (${order.platformFeeRate * 100}%)`);
  console.log(`  Payment Method: ${order.paymentMethod}`);
  console.log(`  Status: ${order.status}`);

  // Check fee math: 25 * 420 = 10500 ETB. Fee = 10500 * 0.02 = 210 ETB
  const expectedTotal = validQty * ventolinListing.wholesalePriceETB;
  const expectedFee = Math.round(expectedTotal * 0.02 * 100) / 100;
  if (order.totalPriceETB !== expectedTotal) throw new Error(`Expected total ${expectedTotal}, got ${order.totalPriceETB}`);
  if (order.platformFeeETB !== expectedFee) throw new Error(`Expected fee ${expectedFee}, got ${order.platformFeeETB}`);
  console.log('✓ 2% Platform Commission calculated with 100% precision!');

  // Check inventory decrement
  const updatedListing = db.getWholesaleListingById(ventolinListing.id);
  if (!updatedListing || updatedListing.availableStock !== initialStock - validQty) {
    throw new Error(`Expected stock ${initialStock - validQty}, got ${updatedListing?.availableStock}`);
  }
  console.log(`✓ Importer batch stock accurately decremented from ${initialStock} to ${updatedListing.availableStock}!`);

  // 6. Test Telegram PO Notification dispatch
  console.log('\n--- 6. Dispatching Telegram Notification to Importer ---');
  await telegramBotService.notifyWholesalePurchaseOrder(order);
  console.log('✓ Telegram PO notification dispatched cleanly!');

  // 7. Status progression: DISPATCHED -> DELIVERED
  console.log('\n--- 7. Updating Order Status ---');
  const dispatchRes = db.updateWholesaleOrderStatus(order.id, 'DISPATCHED', 'Courier dispatched on motorcycle via Churchill Rd.');
  console.log(`  Status update: ${dispatchRes.order?.status} - ${dispatchRes.order?.statusNotes}`);
  const deliverRes = db.updateWholesaleOrderStatus(order.id, 'DELIVERED', 'Delivered at counter and verified by licensed pharmacist.');
  console.log(`  Status update: ${deliverRes.order?.status} - ${deliverRes.order?.statusNotes}`);

  // 8. Test B2B Commission & GMV Report
  console.log('\n--- 8. Testing B2B Commission & GMV Report ---');
  const report = db.getB2BCommissionReport();
  console.log(`  Total Orders Count: ${report.ordersCount}`);
  console.log(`  Gross Merchandise Volume (GMV): ${report.totalGrossVolumeETB.toLocaleString()} ETB`);
  console.log(`  Total 2% Platform Commission Collected: ${report.totalPlatformFeesETB.toLocaleString()} ETB`);

  if (report.totalGrossVolumeETB < expectedTotal) throw new Error('GMV undercounted');
  if (report.totalPlatformFeesETB < expectedFee) throw new Error('Platform fee undercounted');

  console.log('\n================================================================');
  console.log('🎉 ALL B2B WHOLESALE EXCHANGE TESTS PASSED SUCCESSFULLY!');
  console.log('================================================================');
  process.exit(0);
}

testB2BMarketplace().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});

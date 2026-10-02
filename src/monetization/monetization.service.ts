import { DynamicConfigService } from '../config/dynamic-config.service';
import { InMemoryDatabase } from '../database/in-memory-db';
import { TelebirrGatewayService } from './telebirr-gateway.service';
import { AccessDecision, PaymentInvoice } from './subscription.types';

export class MonetizationService {
  private configService = DynamicConfigService.getInstance();
  private db = InMemoryDatabase.getInstance();
  private telebirrGateway = TelebirrGatewayService.getInstance();

  /**
   * Evaluates if a user can perform a search right now,
   * factoring in dynamic free promotion dates, regional overrides, and freemium quotas.
   */
  public evaluateAccess(params: {
    userId: string;
    city?: string;
    subCity?: string;
  }): AccessDecision {
    const policy = this.configService.getPolicy();
    const monetization = policy.monetization;
    const now = new Date();

    // 1. Check Regional Overrides first
    let activeFreePromotionUntil = new Date(monetization.freePromotionUntil);
    let activeMode = monetization.globalMode;

    if (params.city) {
      const match = monetization.regionalOverrides.find((o) => {
        const cityMatches = o.city.toLowerCase() === params.city?.toLowerCase();
        if (!cityMatches) return false;
        if (o.subCity && params.subCity) {
          return o.subCity.toLowerCase() === params.subCity.toLowerCase();
        }
        return true;
      });

      if (match) {
        if (match.mode) activeMode = match.mode;
        if (match.freePromotionUntil) {
          activeFreePromotionUntil = new Date(match.freePromotionUntil);
        }
      }
    }

    // 2. Global / Regional Free Launch Period Check
    if (now < activeFreePromotionUntil) {
      return {
        isAllowed: true,
        reason: 'FREE_PROMOTION_PERIOD',
        freeUntilDate: activeFreePromotionUntil.toISOString(),
      };
    }

    // If completely FREE mode
    if (activeMode === 'FREE') {
      return {
        isAllowed: true,
        reason: 'FREE_PROMOTION_PERIOD',
      };
    }

    // 3. Check Active Paid Subscription Pass
    const userSub = this.db.getOrCreateSubscription(params.userId);
    const expiresAt = new Date(userSub.expiresAt);

    if (userSub.active && expiresAt > now) {
      return {
        isAllowed: true,
        reason: 'ACTIVE_SUBSCRIPTION',
      };
    }

    // 4. Check Freemium Quota
    if (activeMode === 'FREEMIUM' || activeMode === 'HYBRID') {
      if (userSub.monthlySearchesUsed < monetization.freemiumQuotaPerMonth) {
        const remaining = monetization.freemiumQuotaPerMonth - userSub.monthlySearchesUsed;
        return {
          isAllowed: true,
          reason: 'FREEMIUM_QUOTA_REMAINING',
          remainingFreeSearches: remaining,
        };
      }
    }

    // 5. Paywall Triggered: User must pay
    return {
      isAllowed: false,
      reason: 'PAYMENT_REQUIRED',
      paymentOptions: {
        singleSearchFeeETB: monetization.pricing.searchFeeETB,
        monthlyPassFeeETB: monetization.pricing.monthlyPassETB,
        threeMonthPassFeeETB: monetization.pricing.threeMonthPassETB,
      },
    };
  }

  /**
   * Consume 1 search quota after a search is executed
   */
  public recordSearchUsage(userId: string) {
    const userSub = this.db.getOrCreateSubscription(userId);
    userSub.monthlySearchesUsed += 1;
  }

  /**
   * Generate Telebirr Payment Invoice dynamically
   */
  public async generatePaymentInvoice(params: {
    userId: string;
    purpose: 'SINGLE_SEARCH' | 'MONTHLY_PASS' | 'THREE_MONTH_PASS';
  }): Promise<PaymentInvoice> {
    const policy = this.configService.getPolicy();
    const pricing = policy.monetization.pricing;

    let amount = pricing.searchFeeETB;
    if (params.purpose === 'MONTHLY_PASS') amount = pricing.monthlyPassETB;
    if (params.purpose === 'THREE_MONTH_PASS') amount = pricing.threeMonthPassETB;

    const invoice = await this.telebirrGateway.createCheckoutOrder({
      userId: params.userId,
      amountETB: amount,
      purpose: params.purpose,
      telebirrConfig: policy.monetization.paymentGateways.telebirr,
    });

    this.db.invoices.set(invoice.invoiceId, invoice);
    return invoice;
  }

  /**
   * Complete payment (e.g. from Telebirr Webhook or simulated test)
   */
  public completePayment(invoiceId: string): boolean {
    const invoice = this.db.invoices.get(invoiceId);
    if (!invoice) return false;

    invoice.status = 'PAID';
    invoice.paidAt = new Date().toISOString();

    const userSub = this.db.getOrCreateSubscription(invoice.userId);
    const now = new Date();

    if (invoice.purpose === 'SINGLE_SEARCH') {
      // Add 1 extra search allowance
      if (userSub.monthlySearchesUsed > 0) {
        userSub.monthlySearchesUsed -= 1;
      }
    } else if (invoice.purpose === 'MONTHLY_PASS') {
      userSub.active = true;
      userSub.plan = 'MONTHLY_PASS';
      // 30 days pass
      const expiry = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      userSub.expiresAt = expiry.toISOString();
    } else if (invoice.purpose === 'THREE_MONTH_PASS') {
      userSub.active = true;
      userSub.plan = 'THREE_MONTH_PASS';
      // 90 days pass
      const expiry = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
      userSub.expiresAt = expiry.toISOString();
    }

    return true;
  }
}

export type AccessDecision = {
  isAllowed: boolean;
  reason: 
    | 'FREE_PROMOTION_PERIOD'
    | 'ACTIVE_SUBSCRIPTION'
    | 'FREEMIUM_QUOTA_REMAINING'
    | 'PAYMENT_REQUIRED';
  freeUntilDate?: string;
  remainingFreeSearches?: number;
  paymentOptions?: {
    singleSearchFeeETB: number;
    monthlyPassFeeETB: number;
    threeMonthPassFeeETB: number;
  };
};

export interface UserSubscription {
  userId: string;
  plan: 'FREE_TIER' | 'MONTHLY_PASS' | 'THREE_MONTH_PASS';
  active: boolean;
  startsAt: string;
  expiresAt: string;
  monthlySearchesUsed: number;
  lastSearchMonth: string; // YYYY-MM
}

export interface PaymentInvoice {
  invoiceId: string;
  userId: string;
  amountETB: number;
  currency: 'ETB';
  purpose: 'SINGLE_SEARCH' | 'MONTHLY_PASS' | 'THREE_MONTH_PASS' | 'PHARMACY_TIER';
  provider: 'TELEBIRR' | 'CBE_BIRR';
  status: 'PENDING' | 'PAID' | 'EXPIRED' | 'FAILED';
  checkoutUrl: string;
  createdAt: string;
  paidAt?: string;
}

import { v4 as uuidv4 } from 'uuid';
import { PaymentInvoice } from './subscription.types';

export class TelebirrGatewayService {
  private static instance: TelebirrGatewayService;

  private constructor() {}

  public static getInstance(): TelebirrGatewayService {
    if (!TelebirrGatewayService.instance) {
      TelebirrGatewayService.instance = new TelebirrGatewayService();
    }
    return TelebirrGatewayService.instance;
  }

  /**
   * Creates a Telebirr Prepay Order
   */
  public async createCheckoutOrder(params: {
    userId: string;
    amountETB: number;
    purpose: 'SINGLE_SEARCH' | 'MONTHLY_PASS' | 'THREE_MONTH_PASS';
    telebirrConfig: { appId: string; shortCode: string; sandbox: boolean };
  }): Promise<PaymentInvoice> {
    const invoiceId = `INV-${Date.now()}-${uuidv4().substring(0, 6).toUpperCase()}`;

    // In production, this encrypts the request with Telebirr's RSA Public Key and calls Telebirr Prepay API
    // e.g. https://telebirrapi.ethiomobilemoney.et:8888/was/service/order/prepay
    const checkoutUrl = params.telebirrConfig.sandbox
      ? `https://sandbox.telebirr.et/pay?outTradeNo=${invoiceId}&amount=${params.amountETB}`
      : `https://app.telebirr.et/pay?outTradeNo=${invoiceId}&amount=${params.amountETB}`;

    const invoice: PaymentInvoice = {
      invoiceId,
      userId: params.userId,
      amountETB: params.amountETB,
      currency: 'ETB',
      purpose: params.purpose,
      provider: 'TELEBIRR',
      status: 'PENDING',
      checkoutUrl,
      createdAt: new Date().toISOString(),
    };

    return invoice;
  }

  /**
   * Handles Telebirr Webhook Notification when user enters PIN and pays
   */
  public verifyAndProcessWebhook(payload: {
    outTradeNo: string;
    tradeNo: string;
    totalAmount: string;
    tradeStatus: 'Completed' | 'Failed';
  }): { valid: boolean; outTradeNo: string; paid: boolean } {
    // In production, verify RSA signature of payload using Telebirr public key
    const isSuccess = payload.tradeStatus === 'Completed';
    return {
      valid: true,
      outTradeNo: payload.outTradeNo,
      paid: isSuccess,
    };
  }
}

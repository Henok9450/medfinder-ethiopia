import { Request, Response } from 'express';
import { DynamicConfigService } from '../config/dynamic-config.service';
import { InMemoryDatabase } from '../database/in-memory-db';

export class AdminConfigController {
  private configService = DynamicConfigService.getInstance();
  private db = InMemoryDatabase.getInstance();

  /**
   * GET /api/admin/config
   * Returns current active dynamic configuration
   */
  public getConfig = (req: Request, res: Response) => {
    const policy = this.configService.getPolicy();
    res.json({
      success: true,
      policy,
    });
  };

  /**
   * POST /api/admin/config
   * Dynamically update any configuration parameter
   */
  public updateConfig = (req: Request, res: Response) => {
    const result = this.configService.updatePolicy(req.body);
    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error });
    }
    return res.json({
      success: true,
      message: 'System policy updated dynamically at runtime',
      updatedPolicy: result.policy,
    });
  };

  /**
   * POST /api/admin/config/set-free-period
   * Fast toggle to adjust the free promotion cut-off date
   */
  public setFreePeriod = (req: Request, res: Response) => {
    const { freePromotionUntil } = req.body;
    if (!freePromotionUntil) {
      return res.status(400).json({ success: false, error: 'freePromotionUntil ISO date string is required' });
    }

    const result = this.configService.setFreePromotionEndDate(freePromotionUntil);
    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error });
    }

    return res.json({
      success: true,
      message: `Free promotion cutoff date updated to: ${result.freePromotionUntil}`,
      freePromotionUntil: result.freePromotionUntil,
    });
  };

  /**
   * POST /api/admin/config/test-vision-key
   * Test a Google Gemini API key by calling the models API
   */
  public testVisionKey = async (req: Request, res: Response) => {
    const { apiKey } = req.body;
    const keyToTest = apiKey || this.configService.getPolicy()?.features?.geminiApiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

    if (!keyToTest) {
      return res.status(400).json({
        success: false,
        error: 'No Gemini API key provided to test. Please supply an API key.',
      });
    }

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${keyToTest.trim()}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'Respond with exactly: PONG' }] }],
          generationConfig: { maxOutputTokens: 10 },
        }),
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return res.status(400).json({
          success: false,
          error: `Google API rejected the key (${response.status}): ${errorText}`,
        });
      }

      return res.json({
        success: true,
        message: 'Google Gemini Vision API key verified successfully! High-accuracy prescription and medicine scanner is active.',
      });
    } catch (err: any) {
      return res.status(500).json({
        success: false,
        error: `Failed to connect to Google Gemini API: ${err.message}`,
      });
    }
  };

  /**
   * GET /api/admin/stats
   * Monitor platform usage and revenue
   */
  public getStats = (req: Request, res: Response) => {
    const invoices = Array.from(this.db.invoices.values());
    const paidInvoices = invoices.filter((i) => i.status === 'PAID');
    const totalRevenueETB = paidInvoices.reduce((sum, inv) => sum + inv.amountETB, 0);

    const activeSubscriptions = Array.from(this.db.subscriptions.values()).filter(
      (s) => s.active && new Date(s.expiresAt) > new Date()
    ).length;

    res.json({
      success: true,
      stats: {
        totalPharmacies: this.db.pharmacies.length,
        totalBroadcastRequests: this.db.broadcastRequests.size,
        totalInvoicesGenerated: invoices.length,
        paidInvoicesCount: paidInvoices.length,
        totalRevenueETB,
        activeSubscriptionsCount: activeSubscriptions,
        activeFreePromotionDate: this.configService.getPolicy().monetization.freePromotionUntil,
      },
    });
  };
}

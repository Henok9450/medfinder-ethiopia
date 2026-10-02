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

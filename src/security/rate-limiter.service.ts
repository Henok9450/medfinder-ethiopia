/**
 * Rate Limiting & Bot Protection Service for MedFinder Ethiopia
 * 
 * Protects pharmacy inventory data, search endpoints, and counter reservations
 * from automated scraping, crawlers, and denial-of-service attempts.
 */

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  resetInSeconds: number;
  reason?: string;
}

export class RateLimiterService {
  private static instance: RateLimiterService;

  // Key -> Array of request timestamps (epoch ms)
  private searchRequests: Map<string, number[]> = new Map();
  private holdRequests: Map<string, number[]> = new Map();

  // Periodic cleanup interval (runs every 10 minutes)
  private cleanupTimer: NodeJS.Timeout | null = null;

  private constructor() {
    this.cleanupTimer = setInterval(() => this.cleanupOldEntries(), 10 * 60 * 1000);
    // Unref so timer doesn't prevent clean test exits
    if (this.cleanupTimer.unref) this.cleanupTimer.unref();
  }

  public static getInstance(): RateLimiterService {
    if (!RateLimiterService.instance) {
      RateLimiterService.instance = new RateLimiterService();
    }
    return RateLimiterService.instance;
  }

  /**
   * Rate limits medicine searches:
   * - Max 25 searches per 60 seconds
   * - Max 8 searches per 5-second burst
   * - Max 150 searches per 60 minutes
   */
  public checkSearchRateLimit(identifier: string): RateLimitResult {
    const now = Date.now();
    const key = `search_${identifier}`;
    let timestamps = this.searchRequests.get(key) || [];

    // Filter to last 60 minutes
    const oneHourAgo = now - 60 * 60 * 1000;
    timestamps = timestamps.filter((t) => t > oneHourAgo);

    // 1. Check 5-second burst (max 8 requests)
    const fiveSecAgo = now - 5 * 1000;
    const burstCount = timestamps.filter((t) => t > fiveSecAgo).length;
    if (burstCount >= 8) {
      return {
        allowed: false,
        remaining: 0,
        limit: 8,
        resetInSeconds: 5,
        reason: 'BURST_LIMIT_EXCEEDED',
      };
    }

    // 2. Check 60-second window (max 25 requests)
    const oneMinAgo = now - 60 * 1000;
    const minTimestamps = timestamps.filter((t) => t > oneMinAgo);
    if (minTimestamps.length >= 25) {
      const oldestInMin = minTimestamps[0];
      const resetSec = Math.max(1, Math.ceil((oldestInMin + 60 * 1000 - now) / 1000));
      return {
        allowed: false,
        remaining: 0,
        limit: 25,
        resetInSeconds: resetSec,
        reason: 'MINUTE_LIMIT_EXCEEDED',
      };
    }

    // 3. Check 1-hour window (max 150 requests)
    if (timestamps.length >= 150) {
      const oldestInHour = timestamps[0];
      const resetSec = Math.max(1, Math.ceil((oldestInHour + 60 * 60 * 1000 - now) / 1000));
      return {
        allowed: false,
        remaining: 0,
        limit: 150,
        resetInSeconds: resetSec,
        reason: 'HOURLY_LIMIT_EXCEEDED',
      };
    }

    // Record request
    timestamps.push(now);
    this.searchRequests.set(key, timestamps);

    return {
      allowed: true,
      remaining: 25 - minTimestamps.length - 1,
      limit: 25,
      resetInSeconds: 60,
    };
  }

  /**
   * Rate limits reservation hold creation attempts:
   * Max 5 attempts per 10 minutes per IP/patient
   */
  public checkHoldRateLimit(identifier: string): RateLimitResult {
    const now = Date.now();
    const key = `hold_${identifier}`;
    let timestamps = this.holdRequests.get(key) || [];

    const tenMinAgo = now - 10 * 60 * 1000;
    timestamps = timestamps.filter((t) => t > tenMinAgo);

    if (timestamps.length >= 5) {
      const oldest = timestamps[0];
      const resetSec = Math.max(1, Math.ceil((oldest + 10 * 60 * 1000 - now) / 1000));
      return {
        allowed: false,
        remaining: 0,
        limit: 5,
        resetInSeconds: resetSec,
        reason: 'HOLD_RATE_LIMIT_EXCEEDED',
      };
    }

    timestamps.push(now);
    this.holdRequests.set(key, timestamps);

    return {
      allowed: true,
      remaining: 5 - timestamps.length,
      limit: 5,
      resetInSeconds: 600,
    };
  }

  /**
   * Detects known headless scrapers and automated scripts
   */
  public detectBot(userAgent?: string): { isBot: boolean; reason?: string } {
    if (!userAgent || typeof userAgent !== 'string' || userAgent.trim().length === 0) {
      return { isBot: true, reason: 'Missing User-Agent header' };
    }

    const ua = userAgent.toLowerCase();
    const blockedPatterns = [
      'python-requests',
      'aiohttp',
      'scrapy',
      'curl/',
      'wget/',
      'libwww-perl',
      'bytespider',
      'httpclient',
      'headlesschrome',
      'phantomjs',
      'selenium',
      'playwright',
      'postmanruntime',
    ];

    for (const pattern of blockedPatterns) {
      if (ua.includes(pattern)) {
        return { isBot: true, reason: `Automated scraper pattern detected: ${pattern}` };
      }
    }

    return { isBot: false };
  }

  /**
   * Cleans up keys older than 1 hour to prevent memory bloat
   */
  private cleanupOldEntries(): void {
    const now = Date.now();
    const oneHourAgo = now - 60 * 60 * 1000;

    for (const [key, timestamps] of this.searchRequests.entries()) {
      const valid = timestamps.filter((t) => t > oneHourAgo);
      if (valid.length === 0) {
        this.searchRequests.delete(key);
      } else {
        this.searchRequests.set(key, valid);
      }
    }

    const tenMinAgo = now - 10 * 60 * 1000;
    for (const [key, timestamps] of this.holdRequests.entries()) {
      const valid = timestamps.filter((t) => t > tenMinAgo);
      if (valid.length === 0) {
        this.holdRequests.delete(key);
      } else {
        this.holdRequests.set(key, valid);
      }
    }
  }

  /**
   * Helper to reset test states
   */
  public resetForTesting(): void {
    this.searchRequests.clear();
    this.holdRequests.clear();
  }
}

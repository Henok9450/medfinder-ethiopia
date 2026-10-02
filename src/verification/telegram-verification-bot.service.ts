import https from 'https';
import fs from 'fs';
import path from 'path';
import { InMemoryDatabase, TelegramBotSession, PharmacyVerificationApplication, Pharmacy, MASTER_MEDICINE_CATALOG } from '../database/in-memory-db';
import { BroadcastMatchingService } from '../matching/broadcast-matching.service';

/**
 * Robust native HTTPS dispatcher for Telegram Bot API
 * Solves Undici/Node fetch connection pool contention on Windows and guarantees reliable delivery.
 */
async function dispatchTelegramApi(token: string, method: string, payload: any): Promise<any> {
  const postData = Buffer.from(JSON.stringify(payload), 'utf8');
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const result = await new Promise<any>((resolve, reject) => {
        const req = https.request({
          hostname: 'api.telegram.org',
          port: 443,
          path: `/bot${token}/${method}`,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Content-Length': postData.length,
          },
          timeout: 12000,
          agent: false, // Fresh socket to avoid connection pool contention
        }, (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            const raw = Buffer.concat(chunks).toString('utf8');
            try {
              resolve(JSON.parse(raw));
            } catch (e) {
              resolve({ ok: false, description: raw });
            }
          });
        });

        req.on('error', reject);
        req.on('timeout', () => {
          req.destroy();
          reject(new Error('Request to api.telegram.org timed out'));
        });

        req.write(postData);
        req.end();
      });

      return result;
    } catch (err: any) {
      console.warn(`[TelegramBot] Dispatch attempt ${attempt}/3 to /${method} failed: ${err.message}`);
      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, 600 * attempt));
      } else {
        return { ok: false, description: `Network failure: ${err.message}` };
      }
    }
  }
}

export interface TelegramIncomingMessage {
  chatId: string;
  username?: string;
  text?: string;
  photoUrl?: string;
  documentUrl?: string;
  location?: { latitude: number; longitude: number };
}

export interface TelegramBotResponse {
  chatId: string;
  replyText: string;
  quickReplies?: string[];
  inlineKeyboard?: Array<Array<{ text: string; url?: string; callback_data?: string; web_app?: { url: string } }>>;
  sessionStep?: string;
  isComplete?: boolean;
  applicationId?: string;
}

// Addis Ababa Sub-Cities & Core Landmarks for Automatic Geo-Detection
const ADDIS_SUB_CITIES = [
  { name: 'Bole', lat: 9.0015, lng: 38.7845, keywords: ['bole', 'edna', 'airport', 'medhanialem', 'rwanda', 'atlas', 'gerji', 'bulbula', 'hayahulet', '22'] },
  { name: 'Kirkos', lat: 9.0105, lng: 38.7455, keywords: ['kirkos', 'mexico', 'kazanchis', 'meskel', 'wabi', 'lagar', 'leghar', 'beklobet', 'gotera', 'olympia'] },
  { name: 'Yeka', lat: 9.0201, lng: 38.8021, keywords: ['yeka', 'megenagna', 'shola', 'kotebe', 'ferensay', 'lamberet', 'signal', 'kara'] },
  { name: 'Arada', lat: 9.0345, lng: 38.7512, keywords: ['arada', 'piazza', 'churchill', 'arat kilo', '4 kilo', 'somali tera', 'piassa'] },
  { name: 'Nifas Silk', lat: 8.9567, lng: 38.7612, keywords: ['nifas silk', 'saris', 'lafto', 'jemo', 'kera', 'lebua', 'hana mariam'] },
  { name: 'Lideta', lat: 9.0080, lng: 38.7300, keywords: ['lideta', 'balcha', 'tor hailoch', 'kochera', 'abinet', 'geja'] },
  { name: 'Gullele', lat: 9.0600, lng: 38.7300, keywords: ['gullele', 'shiromeda', 'addisu gebeya', 'wingate', 'paulos', 'shumeta'] },
  { name: 'Addis Ketema', lat: 9.0300, lng: 38.7350, keywords: ['addis ketema', 'merkato', 'mercato', 'autobus tera', 'sebategna'] },
  { name: 'Kolfe Keranio', lat: 9.0100, lng: 38.7000, keywords: ['kolfe', 'keranio', 'ayertena', 'ashero tera', 'torhailoch', 'zenebework'] },
  { name: 'Akaky Kaliti', lat: 8.8900, lng: 38.7700, keywords: ['akaki', 'kaliti', 'kality', 'tulu dimtu', 'koye feche'] },
];

function detectSubCityFromCoordinates(lat: number, lng: number): string {
  let closest = 'Bole';
  let minDist = Infinity;
  for (const sc of ADDIS_SUB_CITIES) {
    const d = Math.hypot(lat - sc.lat, lng - sc.lng);
    if (d < minDist) {
      minDist = d;
      closest = sc.name;
    }
  }
  return closest;
}

function parseLocationOrAddress(text: string, location?: { latitude: number; longitude: number }): {
  subCity: string;
  latitude: number;
  longitude: number;
  addressDetails: string;
  isVerifiedGps: boolean;
} {
  // 1. Direct GPS Location sent from Telegram app / Phone sensor
  if (location && typeof location.latitude === 'number' && typeof location.longitude === 'number') {
    const lat = location.latitude;
    const lng = location.longitude;
    const closest = detectSubCityFromCoordinates(lat, lng);
    return {
      subCity: closest,
      latitude: lat,
      longitude: lng,
      addressDetails: `📍 Live Counter GPS: ${lat.toFixed(5)}, ${lng.toFixed(5)} (${closest})`,
      isVerifiedGps: true,
    };
  }

  // 2. Check for Google Maps URL or raw coordinate pair in text
  // e.g. maps.google.com/?q=9.0015,38.7845 or @9.0015,38.7845 or 9.0015, 38.7845
  const coordMatch = text.match(/(?:[?&]q=|@|\s|^)(-?\d{1,2}\.\d+)[,\s]+(-?\d{1,3}\.\d+)/);
  if (coordMatch) {
    const lat = parseFloat(coordMatch[1]);
    const lng = parseFloat(coordMatch[2]);
    if (!isNaN(lat) && !isNaN(lng) && lat > 3 && lat < 15 && lng > 30 && lng < 48) {
      const closest = detectSubCityFromCoordinates(lat, lng);
      return {
        subCity: closest,
        latitude: lat,
        longitude: lng,
        addressDetails: `📍 Map Pin: ${lat.toFixed(5)}, ${lng.toFixed(5)} (${closest})`,
        isVerifiedGps: true,
      };
    }
  }

  // 3. Keyword matching for copied/pasted address text
  const lower = text.toLowerCase();
  for (const sc of ADDIS_SUB_CITIES) {
    for (const kw of sc.keywords) {
      if (lower.includes(kw)) {
        return {
          subCity: sc.name,
          latitude: sc.lat,
          longitude: sc.lng,
          addressDetails: text,
          isVerifiedGps: false,
        };
      }
    }
  }

  // 4. Fallback default
  return {
    subCity: 'Bole',
    latitude: 9.0015,
    longitude: 38.7845,
    addressDetails: text || 'Bole, Addis Ababa',
    isVerifiedGps: false,
  };
}

export interface TelegramBotEndpoint {
  type: 'PHARMACY' | 'PATIENT';
  token?: string;
  botInfo: { id: number; is_bot: boolean; first_name: string; username: string } | null;
  isPolling: boolean;
  isLoopRunning: boolean;
  abortController: AbortController | null;
  lastUpdateId: number;
  lastPollingError?: string;
}

export class TelegramVerificationBotService {
  private db: InMemoryDatabase;
  private broadcastService: BroadcastMatchingService;

  // Dual Dedicated Bot Architecture (Roadmap 2: Industry Standard)
  public pharmacyBot: TelegramBotEndpoint;
  public patientBot: TelegramBotEndpoint;

  constructor() {
    this.db = InMemoryDatabase.getInstance();
    this.broadcastService = new BroadcastMatchingService();

    // 1. Pharmacy Partner Bot (Shelf Inventory, Accreditation & Live Hold Alerts)
    const pharmToken = process.env.TELEGRAM_PHARMACY_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
    this.pharmacyBot = {
      type: 'PHARMACY',
      token: pharmToken,
      botInfo: null,
      isPolling: false,
      isLoopRunning: false,
      abortController: null,
      lastUpdateId: 0,
    };

    // 2. Patient Search Bot (Medicine Radar, Sub-Cities, Geo-Location & 60-min Price Locks)
    const patToken = process.env.TELEGRAM_PATIENT_BOT_TOKEN;
    this.patientBot = {
      type: 'PATIENT',
      token: patToken,
      botInfo: null,
      isPolling: false,
      isLoopRunning: false,
      abortController: null,
      lastUpdateId: 0,
    };

    // Auto-connect configured bots on boot
    if (this.pharmacyBot.token && this.pharmacyBot.token.length > 15) {
      this.connectBot(this.pharmacyBot.token, 'PHARMACY').catch((err) => {
        console.warn('[TelegramBot:PHARMACY] Could not connect on boot:', err.message);
      });
    }

    if (this.patientBot.token && this.patientBot.token.length > 15) {
      this.connectBot(this.patientBot.token, 'PATIENT').catch((err) => {
        console.warn('[TelegramBot:PATIENT] Could not connect on boot:', err.message);
      });
    }
  }

  /**
   * Get live status of both dedicated bots
   */
  public getStatus() {
    return {
      pharmacyBot: {
        hasToken: Boolean(this.pharmacyBot.token && this.pharmacyBot.token.length > 15),
        isConnected: Boolean(this.pharmacyBot.botInfo),
        isPolling: this.pharmacyBot.isPolling,
        botInfo: this.pharmacyBot.botInfo,
        lastError: this.pharmacyBot.lastPollingError,
      },
      patientBot: {
        hasToken: Boolean(this.patientBot.token && this.patientBot.token.length > 15),
        isConnected: Boolean(this.patientBot.botInfo),
        isPolling: this.patientBot.isPolling,
        botInfo: this.patientBot.botInfo,
        lastError: this.patientBot.lastPollingError,
      },
      // Backward compatibility for single-bot clients
      hasToken: Boolean((this.pharmacyBot.token && this.pharmacyBot.token.length > 15) || (this.patientBot.token && this.patientBot.token.length > 15)),
      isConnected: Boolean(this.pharmacyBot.botInfo || this.patientBot.botInfo),
      isPolling: this.pharmacyBot.isPolling || this.patientBot.isPolling,
      botInfo: this.pharmacyBot.botInfo || this.patientBot.botInfo,
      lastError: this.pharmacyBot.lastPollingError || this.patientBot.lastPollingError,
    };
  }

  /**
   * Connect or update a bot token for Pharmacy or Patient bot
   */
  public async connectBot(token: string, type: 'PHARMACY' | 'PATIENT' = 'PHARMACY'): Promise<{ success: boolean; botInfo?: any; error?: string }> {
    const ep = type === 'PATIENT' ? this.patientBot : this.pharmacyBot;
    const cleanToken = token.trim();
    if (!cleanToken || cleanToken.length < 15) {
      return { success: false, error: 'Invalid Bot Token format. Tokens look like 123456789:ABCdefGhI...' };
    }

    try {
      this.stopPolling(ep);
      await new Promise((r) => setTimeout(r, 600));

      // Test token with getMe
      const res = await fetch(`https://api.telegram.org/bot${cleanToken}/getMe`);
      const data = await res.json() as any;

      if (!data.ok || !data.result) {
        ep.lastPollingError = data.description || 'Telegram API rejected token';
        return { success: false, error: ep.lastPollingError };
      }

      // Reset any stale webhook
      try {
        await fetch(`https://api.telegram.org/bot${cleanToken}/deleteWebhook?drop_pending_updates=false`);
      } catch (e) {}

      ep.token = cleanToken;
      ep.botInfo = data.result;
      ep.lastPollingError = undefined;

      if (type === 'PHARMACY') {
        process.env.TELEGRAM_PHARMACY_BOT_TOKEN = cleanToken;
        process.env.TELEGRAM_BOT_TOKEN = cleanToken;
      } else {
        process.env.TELEGRAM_PATIENT_BOT_TOKEN = cleanToken;
      }

      // Persist to .env file so server restarts never lose the tokens
      try {
        const envPath = path.join(process.cwd(), '.env');
        let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : 'PORT=4000\n';
        const key = type === 'PHARMACY' ? 'TELEGRAM_PHARMACY_BOT_TOKEN' : 'TELEGRAM_PATIENT_BOT_TOKEN';
        if (envContent.includes(`${key}=`)) {
          envContent = envContent.replace(new RegExp(`${key}=.*`), `${key}=${cleanToken}`);
        } else {
          envContent += `\n${key}=${cleanToken}`;
        }
        if (type === 'PHARMACY') {
          if (envContent.includes('TELEGRAM_BOT_TOKEN=')) {
            envContent = envContent.replace(/TELEGRAM_BOT_TOKEN=.*/, `TELEGRAM_BOT_TOKEN=${cleanToken}`);
          } else {
            envContent += `\nTELEGRAM_BOT_TOKEN=${cleanToken}`;
          }
        }
        fs.writeFileSync(envPath, envContent.trim() + '\n', 'utf8');
      } catch (err: any) {
        console.warn('[TelegramBot] Could not persist token to .env:', err.message);
      }

      console.log(`[TelegramBot:${type}] Successfully connected to @${ep.botInfo!.username} (${ep.botInfo!.first_name})`);

      // Start long-polling
      this.startPolling(ep);

      return { success: true, botInfo: ep.botInfo };
    } catch (err: any) {
      ep.lastPollingError = err.message;
      return { success: false, error: 'Network error connecting to api.telegram.org: ' + err.message };
    }
  }

  /**
   * Disconnect specific or all bots
   */
  public disconnectBot(type?: 'PHARMACY' | 'PATIENT' | 'ALL') {
    if (!type || type === 'ALL' || type === 'PHARMACY') {
      this.stopPolling(this.pharmacyBot);
      this.pharmacyBot.token = undefined;
      this.pharmacyBot.botInfo = null;
      delete process.env.TELEGRAM_PHARMACY_BOT_TOKEN;
      delete process.env.TELEGRAM_BOT_TOKEN;
    }
    if (!type || type === 'ALL' || type === 'PATIENT') {
      this.stopPolling(this.patientBot);
      this.patientBot.token = undefined;
      this.patientBot.botInfo = null;
      delete process.env.TELEGRAM_PATIENT_BOT_TOKEN;
    }
  }

  /**
   * Long-Polling Runner for a specific bot endpoint
   */
  public startPolling(ep: TelegramBotEndpoint) {
    if (ep.isPolling || ep.isLoopRunning || !ep.token) return;
    ep.isPolling = true;
    ep.isLoopRunning = true;
    console.log(`[TelegramBot:${ep.type}] Starting long-polling engine for @${ep.botInfo?.username || 'bot'}`);

    (async () => {
      while (ep.isPolling && ep.token) {
        try {
          ep.abortController = new AbortController();
          const url = `https://api.telegram.org/bot${ep.token}/getUpdates?offset=${ep.lastUpdateId + 1}&timeout=15`;
          const res = await fetch(url, { signal: ep.abortController.signal });
          const data = await res.json() as any;

          if (data.ok && Array.isArray(data.result)) {
            ep.lastPollingError = undefined;
            for (const update of data.result) {
              ep.lastUpdateId = Math.max(ep.lastUpdateId, update.update_id);

              if (update.message) {
                console.log(`[TelegramBot:${ep.type}] Real message from @${update.message.from?.username || update.message.chat.id}: "${update.message.text || '[Media]'}"`);
                await this.processRealTelegramMessage(ep, update.message);
              } else if (update.callback_query) {
                const cb = update.callback_query;
                console.log(`[TelegramBot:${ep.type}] Real callback_query from @${cb.from?.username || cb.from?.id}: "${cb.data}"`);
                if (ep.token) {
                  dispatchTelegramApi(ep.token, 'answerCallbackQuery', { callback_query_id: cb.id }).catch(() => {});
                }
                const syntheticMsg = {
                  chat: cb.message?.chat || { id: cb.from?.id },
                  from: cb.from,
                  text: cb.data,
                };
                await this.processRealTelegramMessage(ep, syntheticMsg);
              }
            }
          } else if (!data.ok) {
            ep.lastPollingError = data.description;
            console.warn(`[TelegramBot:${ep.type}] Polling issue:`, data.description);
            await new Promise((r) => setTimeout(r, 4000));
          }
        } catch (err: any) {
          if (err.name === 'AbortError') {
            break;
          }
          ep.lastPollingError = err.message;
          await new Promise((r) => setTimeout(r, 3000));
        } finally {
          ep.abortController = null;
        }
      }
      ep.isLoopRunning = false;
    })().catch((err) => {
      console.error(`[TelegramBot:${ep.type}] Fatal in polling loop:`, err);
      ep.isLoopRunning = false;
    });
  }

  public stopPolling(ep?: TelegramBotEndpoint) {
    const targets = ep ? [ep] : [this.pharmacyBot, this.patientBot];
    for (const target of targets) {
      target.isPolling = false;
      if (target.abortController) {
        try {
          target.abortController.abort();
        } catch (e) {}
        target.abortController = null;
      }
    }
  }

  /**
   * Fetch image bytes from Telegram API using available bot token
   */
  public async fetchTelegramFileBuffer(fileId: string): Promise<Buffer | null> {
    const token = this.pharmacyBot.token || this.patientBot.token;
    if (!token) return null;
    try {
      const getFileRes = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`, {
        signal: AbortSignal.timeout(3000),
      });
      const data = await getFileRes.json() as any;
      if (data.ok && data.result?.file_path) {
        const fileUrl = `https://api.telegram.org/file/bot${token}/${data.result.file_path}`;
        const imgRes = await fetch(fileUrl, { signal: AbortSignal.timeout(4000) });
        const arrayBuf = await imgRes.arrayBuffer();
        return Buffer.from(arrayBuf);
      }
    } catch (err: any) {
      console.warn('[TelegramBot] Failed or timed out downloading photo file from Telegram:', err.message);
    }
    return null;
  }


  /**
   * Process a message that arrived from the real Telegram cloud server
   */
  private async processRealTelegramMessage(ep: TelegramBotEndpoint, message: any) {
    const chatId = String(message.chat.id);
    const username = message.from?.username ? `@${message.from.username}` : message.from?.first_name || (ep.type === 'PHARMACY' ? 'Pharmacist' : 'Patient');
    let text = message.text || '';
    let photoUrl: string | undefined;
    let documentUrl: string | undefined;
    let location: { latitude: number; longitude: number } | undefined;

    // Handle photo uploads from phone camera
    if (message.photo && Array.isArray(message.photo) && message.photo.length > 0) {
      const bestPhoto = message.photo[message.photo.length - 1];
      photoUrl = `/api/telegram/media/${bestPhoto.file_id}`;
      if (!text) text = '[Wall Certificate Photo Uploaded]';
    }

    // Handle documents/PDFs
    if (message.document) {
      documentUrl = `/api/telegram/media/${message.document.file_id}`;
      if (!text) text = `[Document Uploaded: ${message.document.file_name || 'license.pdf'}]`;
    }

    // Handle Location sharing (Native GPS Tap from Telegram)
    if (message.location) {
      location = { latitude: message.location.latitude, longitude: message.location.longitude };
      text = `📍 GPS Location: ${message.location.latitude}, ${message.location.longitude}`;
    }

    // Pass into conversational state machine with source bot type
    const botReply = await this.handleIncomingMessage({
      chatId,
      username,
      text,
      photoUrl,
      documentUrl,
      location,
    }, ep.type);

    // Send reply back to the real Telegram app on the user's phone!
    await this.sendRealTelegramReply(chatId, botReply, ep);
  }

  /**
   * Get Telegram Mini App URL
   */
  public getMiniAppUrl(): string {
    const host = process.env.BASE_URL || process.env.APP_BASE_URL || 'https://medfinder-ethiopia.onrender.com';
    return `${host.replace(/\/$/, '')}/miniapp`;
  }

  /**
   * Get Web Pharmacy Studio URL for direct browser access
   */
  public getWebStudioUrl(pharmacyId?: string): string {
    const host = process.env.BASE_URL || process.env.APP_BASE_URL || 'https://medfinder-ethiopia.onrender.com';
    const cleanHost = host.replace(/\/$/, '');
    return pharmacyId ? `${cleanHost}/?tab=pharmacy&pharmId=${pharmacyId}` : `${cleanHost}/?tab=pharmacy`;
  }

  /**
   * Find linked pharmacy for a given Telegram Chat ID
   */
  public getPharmacyForChatId(chatId: string): Pharmacy | undefined {
    // 1. Direct match by telegramChatId
    let p = this.db.pharmacies.find((ph) => ph.telegramChatId === chatId);
    if (p) return p;

    // 2. Approved application link
    const app = this.db.verificationApplications.find(
      (a) => a.telegramChatId === chatId && (a.status === 'APPROVED' || a.approvedPharmacyId)
    );
    if (app) {
      if (app.approvedPharmacyId) {
        p = this.db.pharmacies.find((ph) => ph.id === app.approvedPharmacyId);
        if (p) return p;
      }
      p = this.db.pharmacies.find((ph) => ph.name.toLowerCase() === app.pharmacyName.toLowerCase());
      if (p) return p;
    }

    // 3. Match from active bot session data
    const session = this.db.botSessions.get(chatId);
    if (session?.data?.pharmacyName) {
      p = this.db.pharmacies.find((ph) => ph.name.toLowerCase().includes(session.data.pharmacyName!.toLowerCase()));
      if (p) return p;
    }

    return undefined;
  }

  /**
   * Prompt user to select/link their pharmacy for inventory management
   */
  public promptLinkPharmacy(chatId: string): TelegramBotResponse {
    const inlineKeyboard: Array<Array<{ text: string; callback_data?: string }>> = [];
    const pharms = this.db.pharmacies.slice(0, 6);

    for (let i = 0; i < pharms.length; i += 2) {
      const row: Array<{ text: string; callback_data: string }> = [];
      row.push({
        text: `🏥 ${i + 1}. ${pharms[i].name.replace(/ Pharmacy.*$/i, '').trim().substring(0, 14)} (${pharms[i].subCity})`,
        callback_data: `/manage_${pharms[i].id}`,
      });
      if (pharms[i + 1]) {
        row.push({
          text: `🏥 ${i + 2}. ${pharms[i + 1].name.replace(/ Pharmacy.*$/i, '').trim().substring(0, 14)} (${pharms[i + 1].subCity})`,
          callback_data: `/manage_${pharms[i + 1].id}`,
        });
      }
      inlineKeyboard.push(row);
    }

    inlineKeyboard.push([
      { text: '🏢 አዲስ ፋርማሲ በEFDA አስመዝግብ (/verify)', callback_data: '/verify' },
    ]);

    const replyText = `🏪 **የፋርማሲ ክምችት ማስተዳደሪያ (Pharmacy Inventory Manager)**\n━━━━━━━━━━━━━━━━━━━━━━━━━━\nየመድኃኒት መደርደሪያዎን ለመመዝገብ ወይም ለማስተካከል፣ እባክዎ የሚመሩትን ፋርማሲ ከታች ካሉት ቁልፎች ይምረጡ፦`;

    return {
      chatId,
      replyText,
      quickReplies: [
        '/manage_pharm-bole-01',
        '/manage_pharm-kirkos-8815',
        '/manage_pharm-mexico-05',
        '/manage_pharm-megenagna-02',
        '🏢 /verify',
        '/start'
      ],
      inlineKeyboard,
      sessionStep: 'PHARMACY_INVENTORY',
    };
  }

  /**
   * Send formatted Markdown message + keyboard chips to real Telegram chat
   */
  private async sendRealTelegramReply(chatId: string, reply: TelegramBotResponse, ep?: TelegramBotEndpoint) {
    const activeEndpoint = ep || (this.pharmacyBot.token ? this.pharmacyBot : this.patientBot);
    const token = activeEndpoint.token;
    if (!token) return;

    try {
      // 1. Prepare legacy Telegram markdown (*bold* instead of **bold**)
      const formattedText = reply.replyText.replace(/\*\*(.*?)\*\*/g, '*$1*');

      // 2. Filter & sanitize inlineKeyboard to ensure Telegram compliance
      // Telegram strictly requires web_app URLs to be HTTPS. Localhost http:// URLs trigger 400 Bad Request.
      let cleanInlineKeyboard: Array<Array<any>> | undefined;
      if (reply.inlineKeyboard && reply.inlineKeyboard.length > 0) {
        const rows: Array<Array<any>> = [];
        for (const row of reply.inlineKeyboard) {
          const validButtons: any[] = [];
          for (const btn of row) {
            if (btn.web_app) {
              if (btn.web_app.url && btn.web_app.url.startsWith('https://')) {
                validButtons.push({ text: btn.text, web_app: btn.web_app });
              }
              // Omit non-https / localhost web_app buttons to prevent Telegram rejection
            } else if (btn.url) {
              if (btn.url.startsWith('https://') || (btn.url.startsWith('http://') && !btn.url.includes('localhost'))) {
                validButtons.push({ text: btn.text, url: btn.url });
              }
            } else if (btn.callback_data) {
              validButtons.push({ text: btn.text, callback_data: btn.callback_data });
            }
          }
          if (validButtons.length > 0) {
            rows.push(validButtons);
          }
        }
        if (rows.length > 0) {
          cleanInlineKeyboard = rows;
        }
      }

      const payload: any = {
        chat_id: chatId,
        text: formattedText,
        parse_mode: 'Markdown',
      };

      if (cleanInlineKeyboard && cleanInlineKeyboard.length > 0) {
        payload.reply_markup = {
          inline_keyboard: cleanInlineKeyboard,
        };
      } else if (reply.quickReplies && reply.quickReplies.length > 0) {
        // Arrange quick replies cleanly in 2-column rows for native Telegram mobile display
        const rows: Array<Array<{ text: string; request_location?: boolean }>> = [];
        let currentRow: Array<{ text: string; request_location?: boolean }> = [];

        for (const r of reply.quickReplies) {
          const btn: { text: string; request_location?: boolean } = { text: r };
          if (
            r.includes('Share Current GPS') ||
            r.includes('ቦታዬን በጂፒኤስ ላክ') ||
            r.includes('Share GPS') ||
            r.includes('የኔን ጂፒኤስ ላክ')
          ) {
            btn.request_location = true;
            if (currentRow.length > 0) {
              rows.push(currentRow);
              currentRow = [];
            }
            rows.push([btn]);
            continue;
          }

          currentRow.push(btn);
          if (currentRow.length === 2) {
            rows.push(currentRow);
            currentRow = [];
          }
        }
        if (currentRow.length > 0) {
          rows.push(currentRow);
        }

        payload.reply_markup = {
          keyboard: rows,
          resize_keyboard: true,
          one_time_keyboard: false,
        };
      } else {
        payload.reply_markup = {
          remove_keyboard: true,
        };
      }

      // Execute dispatch with resilient 3-tier fallback using native HTTPS client
      let result = await dispatchTelegramApi(token, 'sendMessage', payload);

      // Tier 2 Fallback: If Telegram markdown entity parser failed, retry as clean plain text
      if (!result.ok) {
        console.warn(`[TelegramBot:${activeEndpoint.type}] Initial sendMessage rejected (${result.description}). Retrying with plain text...`);
        const plainPayload = {
          ...payload,
          parse_mode: undefined,
          text: reply.replyText.replace(/[*_`]/g, ''),
        };
        result = await dispatchTelegramApi(token, 'sendMessage', plainPayload);
      }

      // Tier 3 Fallback: If custom keyboard was rejected, send minimal pure text
      if (!result.ok) {
        console.warn(`[TelegramBot:${activeEndpoint.type}] Keyboard retry rejected (${result.description}). Retrying minimal text...`);
        const minimalPayload = {
          chat_id: chatId,
          text: reply.replyText.replace(/[*_`]/g, ''),
        };
        result = await dispatchTelegramApi(token, 'sendMessage', minimalPayload);
      }

      if (result.ok) {
        console.log(`[TelegramBot:${activeEndpoint.type}] Successfully delivered message to chat ${chatId}`);
      } else {
        console.error(`[TelegramBot:${activeEndpoint.type}] Delivery failed to chat ${chatId}:`, result.description);
      }
    } catch (err: any) {
      console.error(`[TelegramBot:${activeEndpoint.type}] Exception in sendRealTelegramReply:`, err.message);
    }
  }

  /**
   * Execute real-time medicine search for patient across verified pharmacies
   */
  public searchMedicineForPatient(params: {
    chatId: string;
    medicineName: string;
    userLat: number;
    userLng: number;
    subCityName?: string;
    lang?: 'am' | 'en';
  }): TelegramBotResponse {
    const { chatId, medicineName, userLat, userLng, subCityName = 'Addis Ababa', lang = 'am' } = params;
    const q = medicineName.trim().toLowerCase();

    const matches: Array<{
      pharmacy: Pharmacy;
      distanceKm: number;
      priceETB: number;
      itemName: string;
    }> = [];

    for (const pharmacy of this.db.pharmacies) {
      if (pharmacy.isPermanentlyBanned) continue;
      const distance = this.broadcastService.calculateDistanceKm(
        userLat,
        userLng,
        pharmacy.latitude,
        pharmacy.longitude
      );

      // 1. Check structured inventory
      const invMatch = pharmacy.inventory?.find(
        (it) => it.inStock && (it.name.toLowerCase().includes(q) || (it.genericName && it.genericName.toLowerCase().includes(q)) || q.includes(it.name.toLowerCase()))
      );

      if (invMatch) {
        matches.push({
          pharmacy,
          distanceKm: distance,
          priceETB: invMatch.priceETB,
          itemName: invMatch.name,
        });
      } else {
        // 2. Check quick inStockItems array
        const stockMatch = pharmacy.inStockItems?.some((item) => item.toLowerCase().includes(q) || q.includes(item.toLowerCase()));
        if (stockMatch) {
          const cat = MASTER_MEDICINE_CATALOG.find(c => c.name.toLowerCase().includes(q) || q.includes(c.name.toLowerCase()));
          matches.push({
            pharmacy,
            distanceKm: distance,
            priceETB: cat?.defaultPriceETB || 250,
            itemName: medicineName,
          });
        }
      }
    }

    // Sort: Verified first, then highest trustScore, then closest distance
    matches.sort((a, b) => {
      if (a.pharmacy.isVerified !== b.pharmacy.isVerified) {
        return a.pharmacy.isVerified ? -1 : 1;
      }
      if (b.pharmacy.trustScore !== a.pharmacy.trustScore) {
        return b.pharmacy.trustScore - a.pharmacy.trustScore;
      }
      return a.distanceKm - b.distanceKm;
    });

    const miniAppUrl = this.getMiniAppUrl();

    if (matches.length === 0) {
      const emptyText = lang === 'am'
        ? `🔍 **"${medicineName}" በ${subCityName} አካባቢ አልተገኘም**\n━━━━━━━━━━━━━━━━━━━━━━━━━━\nበዚህ ሰዓት በክምችት ላይ ያለ ፋርማሲ አልተገኘም።\n\n💡 **ምን ማድረግ ይችላሉ?**\n1️⃣ ከታች ካሉት አማራጮች ሌላ ክፍለ ከተማ ይምረጡ\n2️⃣ ወይም የመድኃኒቱን ጄነሪክ ስም (Generic Name) ይሞክሩ`
        : `🔍 **"${medicineName}" Not Found in ${subCityName}**\n━━━━━━━━━━━━━━━━━━━━━━━━━━\nNo direct inventory found for this item in this area.\n\n💡 **Options:**\n1️⃣ Try selecting a neighboring sub-city below.\n2️⃣ Switch to another medicine name.`;

      return {
        chatId,
        replyText: emptyText,
        quickReplies: [
          '💊 Insulin',
          '💊 Augmentin',
          '💊 Ventolin',
          '💊 Metformin',
          '📍 Bole',
          '📍 Kirkos',
          '📍 Yeka',
          '/start'
        ],
        inlineKeyboard: [
          [
            { text: '📍 Bole (ቦሌ)', callback_data: `subcity_Bole_${encodeURIComponent(medicineName)}` },
            { text: '📍 Kirkos (ቂርቆስ)', callback_data: `subcity_Kirkos_${encodeURIComponent(medicineName)}` },
          ],
          [
            { text: '📍 Yeka (የካ)', callback_data: `subcity_Yeka_${encodeURIComponent(medicineName)}` },
            { text: '📍 Arada (ፒያሳ)', callback_data: `subcity_Arada_${encodeURIComponent(medicineName)}` },
          ],
          [
            { text: '🔄 አዲስ ፍለጋ (Search)', callback_data: 'search_new' },
            { text: '📍 ክፍለ ከተማ ዝርዝር', callback_data: 'subcity_menu' },
          ]
        ],
        sessionStep: 'PATIENT_SEARCH',
      };
    }

    let replyText = '';
    const topMatches = matches.slice(0, 4);
    const inlineKeyboard: Array<Array<{ text: string; callback_data?: string; url?: string; web_app?: any }>> = [];

    if (lang === 'am') {
      replyText = `🔍 **"${medicineName}" — የተገኙ ቅርብ ፋርማሲዎች**\n`;
      replyText += `📍 መነሻ አካባቢ፦ **${subCityName}**  |  🏥 የተገኙ ፋርማሲዎች፦ **${matches.length}**\n`;
      replyText += `💡 *ከታች ያሉትን [🔒 ዋጋ አስይዝ] ቁልፎች በመጫን ዋጋውን ለ60 ደቂቃ በካውንተር ማስያዝ ይችላሉ።*\n`;
      replyText += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;

      topMatches.forEach((m, idx) => {
        const p = m.pharmacy;
        const num = ['1️⃣', '2️⃣', '3️⃣', '4️⃣'][idx] || '🔹';
        const mapsUrl = `https://maps.google.com/?q=${p.latitude},${p.longitude}`;
        const drugSlug = encodeURIComponent(m.itemName.split(' ')[0]);
        const shortName = p.name.replace(/ Pharmacy.*$/i, '').trim().substring(0, 14);

        replyText += `${num} 🏥 **${p.name}**  ${p.isVerified ? '🛡️ `EFDA Verified`' : ''}\n`;
        replyText += `   📍 **${p.subCity}** • 🚗 **${m.distanceKm} ኪ.ሜ** ርቀት  |  ⭐ የታማኝነት ነጥብ፦ **${p.trustScore}%**\n`;
        replyText += `   💰 የተረጋገጠ ዋጋ፦ **${m.priceETB} ETB** (በህግ የተቆለፈ)\n`;
        replyText += `   📞 ስልክ፦ \`${p.phone}\`  |  🗺️ [ካርታ እይ](${mapsUrl})\n`;
        replyText += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;

        inlineKeyboard.push([
          {
            text: `🔒 ${idx + 1}. ${shortName} (${m.priceETB} ETB) አስይዝ`,
            callback_data: `hold_${p.id}_${drugSlug}`,
          },
          {
            text: `🗺️ ${idx + 1}. ካርታ`,
            url: mapsUrl,
          },
        ]);
      });

      replyText += `\n👇 **ለማስያዝ ከታች ያለውን [🔒 ዋጋ አስይዝ] ይጫኑ፦**`;
    } else {
      replyText = `🔍 **"${medicineName}" — Nearby Available Pharmacies**\n`;
      replyText += `📍 Location: **${subCityName}**  |  🏥 Pharmacies Found: **${matches.length}**\n`;
      replyText += `💡 *Tap the [🔒 Lock Price] buttons below to reserve at the counter for 60 mins.*\n`;
      replyText += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;

      topMatches.forEach((m, idx) => {
        const p = m.pharmacy;
        const num = ['1️⃣', '2️⃣', '3️⃣', '4️⃣'][idx] || '🔹';
        const mapsUrl = `https://maps.google.com/?q=${p.latitude},${p.longitude}`;
        const drugSlug = encodeURIComponent(m.itemName.split(' ')[0]);
        const shortName = p.name.replace(/ Pharmacy.*$/i, '').trim().substring(0, 14);

        replyText += `${num} 🏥 **${p.name}**  ${p.isVerified ? '🛡️ `EFDA Verified`' : ''}\n`;
        replyText += `   📍 **${p.subCity}** • 🚗 **${m.distanceKm} km** away  |  ⭐ Trust: **${p.trustScore}%**\n`;
        replyText += `   💰 Verified Price: **${m.priceETB} ETB** (Price-Locked)\n`;
        replyText += `   📞 Phone: \`${p.phone}\`  |  🗺️ [View Map](${mapsUrl})\n`;
        replyText += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;

        inlineKeyboard.push([
          {
            text: `🔒 ${idx + 1}. ${shortName} (${m.priceETB} ETB)`,
            callback_data: `hold_${p.id}_${drugSlug}`,
          },
          {
            text: `🗺️ ${idx + 1}. Map`,
            url: mapsUrl,
          },
        ]);
      });

      replyText += `\n👇 **Tap a button below to lock the counter price:**`;
    }

    inlineKeyboard.push([
      { text: '🔄 ሌላ መድኃኒት ፈልግ (New Search)', callback_data: 'search_new' },
      { text: '📍 ክፍለ ከተማ ቀይር (Change City)', callback_data: 'subcity_menu' },
    ]);

    return {
      chatId,
      replyText,
      quickReplies: [
        '💊 Insulin',
        '💊 Augmentin',
        '💊 Ventolin',
        '💊 Metformin',
        '📍 Bole',
        '📍 Kirkos',
        '📍 Yeka',
        '/start'
      ],
      inlineKeyboard,
      sessionStep: 'PATIENT_SEARCH'
    };
  }

  /**
   * Real-time counter alert dispatched to pharmacy when a patient locks a medicine price
   */
  public async notifyPharmacyReservationHold(params: {
    pharmacyChatId: string;
    pharmacyName: string;
    drugName: string;
    priceETB: number;
    reservationCode: string;
    expiresAt: string;
    patientChatId?: string;
  }): Promise<boolean> {
    const alertText = `🚨 **አዲስ የመድኃኒት ዋጋ ማስያዣ ደርሶዎታል! (New 60-Minute Counter Hold)**
━━━━━━━━━━━━━━━━━━━━━━━━━━
🔐 **የማስያዣ ቫውቸር ኮድ፦**  \`#${params.reservationCode}\`
━━━━━━━━━━━━━━━━━━━━━━━━━━
🏥 ፋርማሲ፦ **${params.pharmacyName}**
💊 መድኃኒት፦ **${params.drugName}**
💰 የተቆለፈ ዋጋ፦ **${params.priceETB} ETB**
⏳ ተቀባይነት ያለው፦ **ለ 60 ደቂቃ ብቻ (እስከ ${params.expiresAt})**
━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 **የካውንተር መመሪያ፦**
1️⃣ ታካሚው በአንድ ሰዓት ውስጥ መጥቶ ኮድ \`#${params.reservationCode}\` ያሳያል።
2️⃣ እባክዎ ይህን መድኃኒት በካውንተር ላይ ለታካሚው ለ60 ደቂቃ አስቀምጠው በ **${params.priceETB} ETB** ያስረክቡ።
3️⃣ በWeb Studio Counter Desk ላይ ኮዱን በማረጋገጥ +1% የታማኝነት ነጥብ ያግኙ!`;

    const ep = this.pharmacyBot.token ? this.pharmacyBot : this.patientBot;
    if (!ep.token) return false;

    const inlineKeyboard = [
      [
        { text: '✅ ደርሶኛል / እሺ ተይዟል (Acknowledge)', callback_data: `ack_hold_${params.reservationCode}` },
      ],
      [
        { text: '📋 የማመልከቻ ሁኔታ ፈትሽ (/status)', callback_data: '/status' },
      ]
    ];

    await this.sendRealTelegramReply(params.pharmacyChatId, {
      chatId: params.pharmacyChatId,
      replyText: alertText,
      quickReplies: ['✅ ደርሶኛል (Acknowledged)', '/status', '/start'],
      inlineKeyboard,
    }, ep);

    return true;
  }

  /**
   * Conversational state machine with Dedicated Dual-Bot Routing (Roadmap 2)
   */
  public async handleIncomingMessage(
    msg: TelegramIncomingMessage,
    sourceBotType: 'PHARMACY' | 'PATIENT' = 'PHARMACY'
  ): Promise<TelegramBotResponse> {
    const { chatId, username = 'pharmacist_et', text = '', photoUrl, documentUrl, location } = msg;
    const cleanText = text.trim();
    const pharmUsername = this.pharmacyBot.botInfo?.username || 'MedFinder_Verifier_bot';
    const patientUsername = this.patientBot.botInfo?.username || 'MedFinder_ET_bot';

    // Retrieve or initialize conversation session with strict bot-type isolation
    const sessionKey = `${sourceBotType}:${chatId}`;
    let session = this.db.botSessions.get(sessionKey);
    if (!session) {
      const legacySession = this.db.botSessions.get(chatId);
      if (legacySession && legacySession.mode === sourceBotType) {
        session = legacySession;
      } else {
        session = {
          chatId,
          username,
          step: 'START',
          data: {},
          language: 'am',
          mode: sourceBotType,
        };
      }
      this.db.botSessions.set(sessionKey, session);
    }
    session.mode = sourceBotType;

    // ==========================================
    // DEDICATED PATIENT BOT FLOW (sourceBotType: PATIENT)
    // ==========================================
    if (sourceBotType === 'PATIENT') {
      // 1. Patient Welcome Screen
      if (cleanText === '/start' || cleanText.toLowerCase() === 'reset') {
        session.mode = 'PATIENT';
        session.step = 'PATIENT_SEARCH';
        const miniAppUrl = this.getMiniAppUrl();
        return {
          chatId,
          replyText: `🇪🇹 **እንኳን ወደ MedFinder ኢትዮጵያ የመድኃኒት መፈለጊያ ቦት በደህና መጡ!**
━━━━━━━━━━━━━━━━━━━━━━━━━━
💊 **Welcome to MedFinder Patient Medicine Radar**

በአቅራቢያዎ ያሉ የተረጋገጡ ፋርማሲዎችን (EFDA Verified)፣ ትክክለኛ የመድኃኒት ዋጋ እና ክምችት በቅጽበት ይፈልጉ!

🔍 **እንዴት መፈለግ ይችላሉ?**
1️⃣ የሚፈልጉትን መድኃኒት ስም እዚህ ይጻፉ (ምሳሌ፦ *Insulin*, *Ventolin*, *Augmentin*...)
2️⃣ ወይም ከታች ካሉት ፈጣን ቁልፎች አንዱን ይጫኑ
3️⃣ የተገኘውን መድኃኒት ዋጋ ለ60 ደቂቃ በካውንተር ለማስያዝ **[🔒 ዋጋ አስይዝ]** ቁልፍን ይጫኑ!
━━━━━━━━━━━━━━━━━━━━━━━━━━
👇 **ፈጣን ፍለጋ ለመጀመር ከታች ይምረጡ፦**`,
          quickReplies: [
            '💊 Insulin',
            '💊 Augmentin',
            '💊 Ventolin',
            '💊 Metformin',
            '📍 አቅራቢያዬን ፈልግ (Share GPS)',
            '📍 ክፍለ ከተማ ምረጥ (Sub-City)',
            '/start',
          ],
          inlineKeyboard: [
            [
              { text: '💊 Insulin (ኢንሱሊን)', callback_data: 'search_Insulin' },
              { text: '💊 Ventolin (ቬንቶሊን)', callback_data: 'search_Ventolin' },
            ],
            [
              { text: '💊 Augmentin (ኦግመንቲን)', callback_data: 'search_Augmentin' },
              { text: '💊 Metformin (ሜትፎርሚን)', callback_data: 'search_Metformin' },
            ],
            [
              { text: '📍 ክፍለ ከተማ ምረጥ (Sub-City)', callback_data: 'subcity_menu' },
            ],
          ],
          sessionStep: 'PATIENT_SEARCH',
        };
      }

      // 2. Patient Sub-City Selector
      if (cleanText === '📍 ክፍለ ከተማ ምረጥ (Sub-City)' || cleanText.includes('ክፍለ ከተማ ምረጥ')) {
        return {
          chatId,
          replyText: `📍 **የሚገኙበትን ክፍለ ከተማ ይምረጡ / Select Sub-City**\n━━━━━━━━━━━━━━━━━━━━━━━━━━\nበአቅራቢያዎ ያሉ ፋርማሲዎችን በትክክል ለማግኘት ከታች ካሉት ይምረጡ፦`,
          quickReplies: [
            '📍 Bole (ቦሌ)',
            '📍 Kirkos (ቂርቆስ)',
            '📍 Yeka (የካ)',
            '📍 Arada (ፒያሳ)',
            '📍 Nifas Silk (ሳሪስ)',
            '📍 Lideta (ልደታ)',
            '/start',
          ],
          inlineKeyboard: [
            [
              { text: '📍 Bole (ቦሌ)', callback_data: 'subcity_Bole' },
              { text: '📍 Kirkos (ቂርቆስ)', callback_data: 'subcity_Kirkos' },
            ],
            [
              { text: '📍 Yeka (የካ)', callback_data: 'subcity_Yeka' },
              { text: '📍 Arada (ፒያሳ)', callback_data: 'subcity_Arada' },
            ],
            [
              { text: '📍 Nifas Silk (ሳሪስ)', callback_data: 'subcity_NifasSilk' },
              { text: '📍 Lideta (ልደታ)', callback_data: 'subcity_Lideta' },
            ],
          ],
          sessionStep: 'PATIENT_SEARCH',
        };
      }

      // 3. Redirection for Pharmacy Owners who stumble into the Patient Bot
      if (
        cleanText === '/verify' ||
        cleanText.includes('የፋርማሲ ምዝገባ') ||
        cleanText === '/inventory' ||
        cleanText === '/stock' ||
        cleanText === '/shelf' ||
        cleanText === '/import_checklist' ||
        cleanText.startsWith('/manage') ||
        cleanText.startsWith('/add') ||
        cleanText.startsWith('/toggle')
      ) {
        return {
          chatId,
          replyText: `🏥 **የፋርማሲ ባለቤት ወይም ሰራተኛ ነዎት? (Are you a Pharmacy Owner/Staff?)**
━━━━━━━━━━━━━━━━━━━━━━━━━━
ይህ ቦት ለታካሚዎች የመድኃኒት ፍለጋ ብቻ የተዘጋጀ ነው።

የመድኃኒት መደርደሪያዎን ለመመዝገብ፣ ክምችት ለመጨመር ወይም በEFDA ለመረጋገጥ እባክዎ ይፋዊውን **የፋርማሲ አጋር ቦት** ይጠቀሙ፦
👉 @${pharmUsername}`,
          quickReplies: ['💊 Insulin', '💊 Augmentin', '📍 አቅራቢያዬን ፈልግ (Share GPS)', '/start'],
          inlineKeyboard: [
            [{ text: `🏥 Open Pharmacy Partner Bot (@${pharmUsername})`, url: `https://t.me/${pharmUsername}` }]
          ],
          sessionStep: 'PATIENT_SEARCH',
        };
      }
    }

    // =========================================================================
    // 🏛️ CHANNEL 1: DEDICATED PHARMACY REGISTRATION & VERIFICATION DESK BOT
    // =========================================================================
    if (sourceBotType === 'PHARMACY') {
      // 1. Pharmacist Acknowledgment of Hold Reservation (Counter Notification)
      if (cleanText.startsWith('ack_hold_')) {
        const code = cleanText.replace(/^ack_hold_/, '');
        return {
          chatId,
          replyText: `✅ **የትዕዛዝ ደረሰኝ ተረጋግጧል! (Hold Acknowledged)**\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n🔐 የማስያዣ ኮድ፦ **#${code}**\n\nታካሚው በአንድ ሰዓት ውስጥ መጥቶ ይህን ኮድ በካውንተር ሲያሳይ መድኃኒቱን ያስረክቡ። እናመሰግናለን! 🏥`,
          quickReplies: ['/status', '/verify', '/help'],
          inlineKeyboard: [
            [{ text: '📋 የማመልከቻ ሁኔታ ፈትሽ (/status)', callback_data: '/status' }],
          ],
          sessionStep: 'START',
        };
      }

      // 2. Resubmission if Compliance Desk requested info (INFO_REQUESTED)
      const waitingApp = this.db.verificationApplications.find(
        (a) => a.telegramChatId === chatId && (a.status === 'INFO_REQUESTED' || a.id === session?.updatingApplicationId)
      );

      if (waitingApp && (session.step === 'AWAITING_INFO_UPDATE' || waitingApp.status === 'INFO_REQUESTED' || photoUrl || documentUrl)) {
        let updateSummary = '';

        if (photoUrl || documentUrl) {
          const newMedia = photoUrl || documentUrl;
          this.db.resubmitVerificationApplication(waitingApp.id, {
            photoUrl: newMedia,
            note: 'Pharmacist uploaded updated Certificate of Competence photo via Telegram',
          });
          updateSummary = session.language === 'am'
            ? `📸 አዲሱ የብቃት ማረጋገጫ (CoC) ፎቶ በተሳካ ሁኔታ ተቀብለናል!`
            : `📸 New Certificate of Competence photo successfully received!`;
        } else if (location) {
          const parsedLoc = parseLocationOrAddress(cleanText || '', location);
          this.db.resubmitVerificationApplication(waitingApp.id, {
            location: {
              latitude: parsedLoc.latitude,
              longitude: parsedLoc.longitude,
              subCity: parsedLoc.subCity,
              addressDetails: parsedLoc.addressDetails,
            },
            note: `Pharmacist updated physical GPS location: ${parsedLoc.subCity} (${parsedLoc.latitude}, ${parsedLoc.longitude})`,
          });
          updateSummary = session.language === 'am'
            ? `📍 የተስተካከለው የፋርማሲ ጂፒኤስ አድራሻ ተመዝግቧል (${parsedLoc.subCity})!`
            : `📍 Updated pharmacy GPS location recorded (${parsedLoc.subCity})!`;
        } else if (cleanText.toUpperCase().includes('EFDA') || cleanText.toUpperCase().includes('TIN')) {
          const isEFDA = cleanText.toUpperCase().includes('EFDA');
          this.db.resubmitVerificationApplication(waitingApp.id, {
            efdaLicenseNumber: isEFDA ? cleanText : undefined,
            tinNumber: !isEFDA ? cleanText : undefined,
            note: `Pharmacist updated ${isEFDA ? 'EFDA License' : 'TIN'} number to: ${cleanText}`,
          });
          updateSummary = session.language === 'am'
            ? `✍️ የተስተካከለው ቁጥር (${cleanText}) በማመልከቻዎ ላይ ተመዝግቧል!`
            : `✍️ Updated registration number (${cleanText}) recorded!`;
        } else {
          this.db.resubmitVerificationApplication(waitingApp.id, {
            note: `Applicant note: "${cleanText}"`,
          });
          updateSummary = session.language === 'am'
            ? `📝 የሰጡት ማብራሪያ በማመልከቻዎ ላይ ተካቷል!`
            : `📝 Your written explanation has been attached to your application!`;
        }

        session.step = 'START';
        session.updatingApplicationId = undefined;

        const reply = session.language === 'am'
          ? `
✅ **ማመልከቻዎ በተሳካ ሁኔታ ታድሶ ተልኳል!**
**Application Resubmitted Successfully!**

${updateSummary}

• የማመልከቻ መለያ፦ **${waitingApp.id}** (${waitingApp.pharmacyName})
• ሁኔታ፦ **🔄 እንደገና በግምገማ ላይ (Resubmitted - Pending Review)**

የMedFinder የቁጥጥር ቡድን (Compliance Desk) የላኩትን አዲስ መረጃ በፍጥነት አይቶ ውሳኔ ይሰጣል። 
ሁኔታውን ለመከታተል 👉 **/status** ብለው ይጻፉ።
`
          : `
✅ **Application Resubmitted Successfully!**

${updateSummary}

• Application ID: **${waitingApp.id}** (${waitingApp.pharmacyName})
• Status: **🔄 Resubmitted - Pending Review**

The EFDA Compliance Desk has been notified of your updated submission and will review it promptly.
Type **/status** at any time to monitor progress.
`;

        return {
          chatId,
          replyText: reply,
          quickReplies: ['/status', '/help'],
          sessionStep: 'START',
        };
      }

      // 3. Welcome / Reset Command (/start)
      if (cleanText === '/start' || cleanText.toLowerCase() === 'reset') {
        session.step = 'START';
        const existingApp = this.db.verificationApplications.find((a) => a.telegramChatId === chatId);

        if (existingApp) {
          const statusAm = existingApp.status === 'APPROVED' 
            ? '✅ ጸድቋል (Approved - Verified Shield Active)' 
            : existingApp.status === 'REJECTED' 
              ? '❌ ውድቅ ተደርጓል (Rejected)' 
              : existingApp.status === 'INFO_REQUESTED'
                ? 'ℹ️ ተጨማሪ ሰነድ ተጠይቋል (Action Required)'
                : existingApp.status === 'RESUBMITTED'
                  ? '🔄 ታድሶ በግምገማ ላይ (Resubmitted - Pending Review)'
                  : '⏳ በግምገማ ላይ (Pending EFDA Review)';

          return {
            chatId,
            replyText: `🇪🇹 **የኢትዮጵያ ምግብና መድኃኒት ባለስልጣን (EFDA) የፋርማሲ ማረጋገጫ ፖርታል**
━━━━━━━━━━━━━━━━━━━━━━━━━━
🏛️ **MedFinder EFDA Pharmacy Verification Desk**

• የማመልከቻ መለያ፦ \`${existingApp.id}\`
• ፋርማሲ፦ **${existingApp.pharmacyName}**
• አድራሻ፦ **${existingApp.subCity}** ${existingApp.gpsLocationVerified ? '🟢 (GPS Locked)' : ''}
• የEFDA ፈቃድ (CoC)፦ \`${existingApp.efdaLicenseNumber}\`
• አሁን ያለበት ሁኔታ፦ **${statusAm}**
━━━━━━━━━━━━━━━━━━━━━━━━━━
👇 **ፈጣን አገልግሎቶች፦**`,
            quickReplies: ['📋 የፈቃድ ሁኔታ (/status)', '🏢 አዲስ ማመልከቻ (/verify)', '📖 የEFDA መመሪያዎች (/help)'],
            inlineKeyboard: [
              [
                { text: '📋 የፈቃድ ሁኔታ ፈትሽ (/status)', callback_data: '/status' },
              ],
              [
                { text: '🏢 አዲስ ማመልከቻ አስገባ (/verify)', callback_data: '/verify' },
                { text: '📖 የEFDA መስፈርቶች (/help)', callback_data: '/help' },
              ],
            ],
            sessionStep: 'START',
          };
        }

        return {
          chatId,
          replyText: `🇪🇹 **የኢትዮጵያ ምግብና መድኃኒት ባለስልጣን (EFDA) የፋርማሲ ማረጋገጫ ፖርታል**
━━━━━━━━━━━━━━━━━━━━━━━━━━
🏛️ **MedFinder EFDA Pharmacy Verification & Accreditation Desk**

ይህ ቦት በኢትዮጵያ ውስጥ ፈቃድ ያላቸው ፋርማሲዎች የብቃት ማረጋገጫቸውን (EFDA CoC) እና የንግድ ፈቃዳቸውን በማስገባት የተረጋገጠ አረንጓዴ ባጅ (**🛡️ EFDA Verified Shield**) የሚያገኙበት ይፋዊ ፖርታል ነው።

✨ **የተረጋገጠ አባል መሆን የሚያስገኛቸው ጥቅሞች፦**
• የታካሚዎችን አመኔታ 100% ማሳደግ
• በMedFinder ራዳር ካርታ ላይ ቀዳሚ ሆኖ መታየት
• የ60 ደቂቃ የታካሚ ዋጋ ማስያዣ ትዕዛዞችን በካውንተር መቀበል
━━━━━━━━━━━━━━━━━━━━━━━━━━
👇 **ለመጀመር ከታች ካሉት አማራጮች ይምረጡ፦**`,
          quickReplies: [
            '🏢 አዲስ ፋርማሲ በEFDA አስመዝግብ (/verify)',
            '📋 የማመልከቻ ሁኔታ ፈትሽ (/status)',
            '📖 የEFDA መስፈርቶች (/help)',
          ],
          inlineKeyboard: [
            [
              { text: '🏢 አዲስ ፋርማሲ በEFDA አስመዝግብ (/verify)', callback_data: '/verify' },
            ],
            [
              { text: '📋 የማመልከቻ ሁኔታ ፈትሽ (/status)', callback_data: '/status' },
              { text: '📖 የEFDA መስፈርቶችና መመሪያዎች (/help)', callback_data: '/help' },
            ],
          ],
          sessionStep: 'START',
        };
      }

      // 4. Start Pharmacy Registration / Verification (/verify)
      if (cleanText === '/verify' || cleanText.includes('የፋርማሲ ምዝገባ') || cleanText === 'verify') {
        session.step = 'LANGUAGE';
        session.data = { telegramChatId: chatId, telegramUsername: username };
        return {
          chatId,
          replyText: `🇪🇹 **እንኳን ወደ MedFinder ኢትዮጵያ ማረጋገጫ ቦት በደህና መጡ!**
━━━━━━━━━━━━━━━━━━━━━━━━━━
🏛️ **MedFinder EFDA Accreditation Onboarding**

ይህ ቦት ፈቃድ ያላቸው ፋርማሲዎች የብቃት ማረጋገጫ (EFDA CoC) እና የንግድ ፈቃድ በማስገባት የተረጋገጠ አረንጓዴ ባጅ (EFDA Verified Shield) የሚያገኙበት ነው።

እባክዎ ቋንቋ ይምረጡ / Please choose your language:`,
          quickReplies: ['1. አማርኛ (Amharic)', '2. English'],
          inlineKeyboard: [
            [
              { text: '🇪🇹 አማርኛ (Amharic)', callback_data: '1' },
              { text: '🇬🇧 English', callback_data: '2' },
            ]
          ],
          sessionStep: 'LANGUAGE',
        };
      }

      // 5. Check Application Status (/status)
      if (cleanText === '/status' || cleanText.includes('ሁኔታ ፈትሽ') || cleanText.includes('የፈቃድ ሁኔታ')) {
        const existing = this.db.verificationApplications.filter((a) => a.telegramChatId === chatId);
        if (existing.length === 0) {
          return {
            chatId,
            replyText: `ℹ️ ምንም የተመዘገበ ማመልከቻ አልተገኘም።
━━━━━━━━━━━━━━━━━━━━━━━━━━
የፋርማሲዎን የEFDA ማረጋገጫ ለማግኘት ከታች ያለውን **[🏢 አዲስ ፋርማሲ አስመዝግብ]** ቁልፍ ይጫኑ።`,
            quickReplies: ['/verify', '/help', '/start'],
            inlineKeyboard: [
              [{ text: '🏢 አዲስ ፋርማሲ አስመዝግብ (/verify)', callback_data: '/verify' }]
            ],
            sessionStep: 'START',
          };
        }
        const latest = existing[0];
        const statusAm = latest.status === 'APPROVED' 
          ? '✅ ጸድቋል (Approved - Verified Shield Active)' 
          : latest.status === 'REJECTED' 
            ? '❌ ውድቅ ተደርጓል (Rejected)' 
            : latest.status === 'INFO_REQUESTED'
              ? 'ℹ️ ተጨማሪ ሰነድ ተጠይቋል (Action Required - Info Requested)'
              : latest.status === 'RESUBMITTED'
                ? '🔄 ታድሶ በግምገማ ላይ (Resubmitted - Pending Re-Review)'
                : '⏳ በግምገማ ላይ ነው (Pending EFDA Review)';
        return {
          chatId,
          replyText: `📋 **የማመልከቻ ሁኔታ / Application Status**
━━━━━━━━━━━━━━━━━━━━━━━━━━
• ማመልከቻ ቁጥር (ID): **${latest.id}**
• ፋርማሲ፦ **${latest.pharmacyName}**
• አድራሻ (Location): **${latest.subCity}** ${latest.gpsLocationVerified ? '🟢 (GPS Locked)' : ''}
• የEFDA ፈቃድ፦ \`${latest.efdaLicenseNumber}\`
• ሁኔታ፦ **${statusAm}**
• የገመገመው ቡድን ማስታወሻ፦ *${latest.adminNotes || 'Cross-referencing with EFDA iRIS registry.'}*
━━━━━━━━━━━━━━━━━━━━━━━━━━`,
          quickReplies: latest.status === 'INFO_REQUESTED' ? ['📸 አዲስ ፎቶ ላክ', '/verify', '/help'] : ['/verify', '/help', '/start'],
          inlineKeyboard: latest.status === 'INFO_REQUESTED' ? [
            [{ text: '🏢 አዲስ ማመልከቻ አስገባ (/verify)', callback_data: '/verify' }]
          ] : [
            [{ text: '🏢 አዲስ ማመልከቻ (/verify)', callback_data: '/verify' }]
          ],
          sessionStep: 'START',
        };
      }

      // 6. Help / Guidelines for EFDA Accreditation (/help)
      if (cleanText === '/help' || cleanText.includes('መመሪያ')) {
        return {
          chatId,
          replyText: `📖 **የEFDA የፋርማሲ ምዝገባ እና ማረጋገጫ መመሪያ (Accreditation Guide)**
━━━━━━━━━━━━━━━━━━━━━━━━━━
🏛️ **የሚያስፈልጉ ሰነዶች እና መስፈርቶች፦**
1️⃣ **የፋርማሲ ስም እና ትክክለኛ አድራሻ (GPS)**
2️⃣ **የኃላፊ ባለሙያ ስም እና የሙያ ፈቃድ ቁጥር** (Professional License)
3️⃣ **የEFDA የብቃት ማረጋገጫ (CoC)** ፈቃድ ቁጥር እና የሰነዱ ፎቶ
4️⃣ **የንግድ ምዝገባ TIN ቁጥር**

⏳ **የግምገማ ጊዜ፦**
ማመልከቻዎ እንደገባ በ24 ሰዓታት ውስጥ በMedFinder የቁጥጥር እና ተገዢነት ቡድን (Compliance Desk) ከEFDA iRIS ዳታቤዝ ጋር ተገናኝቶ ይረጋገጣል።

👉 ምዝገባ ለመጀመር፦ **/verify**
👉 ሁኔታዎን ለማየት፦ **/status**`,
          quickReplies: ['/verify', '/status', '/start'],
          inlineKeyboard: [
            [
              { text: '🏢 አዲስ ፋርማሲ አስመዝግብ (/verify)', callback_data: '/verify' },
              { text: '📋 ሁኔታ ፈትሽ (/status)', callback_data: '/status' },
            ]
          ],
          sessionStep: 'START',
        };
      }

      // 7. Active Step-by-Step Accreditation Questionnaire (When session.step !== 'START')
      if (session.step && session.step !== 'START') {
        return this.processAccreditationStep(session, cleanText, photoUrl, documentUrl, location, chatId);
      }

      // 8. Standalone Wall Certificate / CoC photo upload outside active registration
      if (photoUrl || documentUrl) {
        return {
          chatId,
          replyText: `📸 **የብቃት ማረጋገጫ (CoC) ሰነድ ተቀብለናል!**
━━━━━━━━━━━━━━━━━━━━━━━━━━
ይህን ሰነድ ለፋርማሲዎ ይፋዊ ምዝገባ ለመጠቀም እባክዎ ከታች ያለውን **[🏢 በEFDA አስመዝግብ]** ይጫኑ፦`,
          quickReplies: ['/verify', '/status', '/help'],
          inlineKeyboard: [
            [{ text: '🏢 አዲስ ፋርማሲ በEFDA አስመዝግብ (/verify)', callback_data: '/verify' }]
          ],
          sessionStep: 'START',
        };
      }

      // 9. Redirect for any other input (e.g. Medicine searches like Ventolin, Insulin, general text)
      // STRICT REQUIREMENT: @MedFinder_Verifier_bot DOES NOT RUN PHARMACY FINDER / MEDICINE SEARCH!
      return {
        chatId,
        replyText: `🏢 **MedFinder EFDA Pharmacy Verification Desk**
━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️ **ይህ ቦት ለፋርማሲ ምዝገባ እና ማረጋገጫ ብቻ የተዘጋጀ ነው!**
*(This bot is dedicated exclusively to Pharmacy Registration & EFDA Accreditation.)*

💊 **መድኃኒት መፈለግ ይፈልጋሉ?**
በአቅራቢያዎ ያሉ ፋርማሲዎችን፣ ትክክለኛ ዋጋ እና ክምችት ለመፈለግ እባክዎ ይፋዊውን **የታካሚ መድኃኒት መፈለጊያ ቦት** ይጠቀሙ፦
👉 **@${patientUsername}** (MedFinder Patient Medicine Finder)
━━━━━━━━━━━━━━━━━━━━━━━━━━
👇 **የፋርማሲ ምዝገባ አገልግሎቶች፦**
• አዲስ ፋርማሲ ለማስመዝገብ 👉 **/verify**
• የማመልከቻ ሁኔታዎን ለመከታተል 👉 **/status**
• የEFDA መስፈርቶችን ለማየት 👉 **/help**`,
        quickReplies: ['/verify', '/status', '/help', '/start'],
        inlineKeyboard: [
          [
            { text: `🔍 መድኃኒት በ @${patientUsername} ፈልግ`, url: `https://t.me/${patientUsername}` },
          ],
          [
            { text: '🏢 አዲስ ፋርማሲ አስመዝግብ (/verify)', callback_data: '/verify' },
            { text: '📋 የፈቃድ ሁኔታ ፈትሽ (/status)', callback_data: '/status' },
          ],
          [
            { text: '📖 የEFDA መስፈርቶች (/help)', callback_data: '/help' },
          ]
        ],
        sessionStep: 'START',
      };
    }

    // Global reset / start fallback for single-bot setup
    if (cleanText === '/start' || cleanText.toLowerCase() === 'reset') {
      session.mode = 'PATIENT';
      session.step = 'PATIENT_SEARCH';
      const miniAppUrl = this.getMiniAppUrl();
      return {
        chatId,
        replyText: `🇪🇹 **እንኳን ወደ MedFinder ኢትዮጵያ በደህና መጡ!**\n**Welcome to MedFinder Ethiopia Search Bot** 💊\n\nበአቅራቢያዎ ያሉ የተረጋገጡ ፋርማሲዎችን (EFDA Verified)፣ ትክክለኛ የመድኃኒት ዋጋ እና ክምችት በቅጽበት ይፈልጉ!\n\n🔍 **እንዴት መፈለግ ይችላሉ?**\n1️⃣ የሚፈልጉትን መድኃኒት ስም እዚህ ይጻፉ (ለምሳሌ፦ *Insulin*, *Augmentin*, *Ventolin*, *Metformin*)\n2️⃣ ወይም ከታች ያለውን **📱 Open Telegram Mini App** ቁልፍ በመጫን የቀጥታ ራዳር ካርታውን ይክፈቱ!\n\n🏢 **ለፋርማሲ ባለቤቶች፦** የመድኃኒት መደርደሪያዎን ለማስተዳደር 👉 **/inventory** ይጫኑ።`,
        quickReplies: [
          '💊 Insulin',
          '💊 Augmentin',
          '💊 Ventolin',
          '💊 Metformin',
          '📍 የኔን ጂፒኤስ ላክ (Share GPS)',
          '🏢 የፋርማሲ ምዝገባ (/verify)',
        ],
        inlineKeyboard: [
          [{ text: '📱 Open Telegram Mini App', web_app: { url: miniAppUrl } }]
        ],
        sessionStep: 'PATIENT_SEARCH',
      };
    }

    if (cleanText === '/verify' || cleanText.includes('የፋርማሲ ምዝገባ')) {
      session.mode = 'PHARMACY';
      session.step = 'LANGUAGE';
      session.data = { telegramChatId: chatId, telegramUsername: username };
      return {
        chatId,
        replyText: `🇪🇹 **እንኳን ወደ MedFinder ኢትዮጵያ ማረጋገጫ ቦት በደህና መጡ!**\nWelcome to **MedFinder Verification Bot**!\n\nይህ ቦት ፈቃድ ያላቸው ፋርማሲዎች የብቃት ማረጋገጫ (EFDA CoC) እና የንግድ ፈቃድ በማስገባት የተረጋገጠ አረንጓዴ ባጅ (EFDA Verified Shield) የሚያገኙበት ነው።\n\nእባክዎ ቋንቋ ይምረጡ / Please choose your language:`,
        quickReplies: ['1. አማርኛ (Amharic)', '2. English'],
        sessionStep: 'LANGUAGE',
      };
    }

    if (cleanText === '/miniapp' || cleanText.toLowerCase().includes('open mini app') || cleanText.toLowerCase().includes('open telegram mini app')) {
      const miniAppUrl = this.getMiniAppUrl();
      return {
        chatId,
        replyText: `📱 **MedFinder Ethiopia Telegram Mini App**\n\nከስልክዎ ሳይወጡ የቀጥታ የመድኃኒት ራዳር፣ የተረጋገጠ ዋጋ እና የ60 ደቂቃ ዋጋ ማስያዣን በሞባይል ተሞክሮ ይጠቀሙ! 👇`,
        inlineKeyboard: [
          [{ text: '🚀 Launch Telegram Mini App', web_app: { url: miniAppUrl } }]
        ],
        quickReplies: ['💊 Insulin', '💊 Augmentin', '💊 Ventolin', '/start'],
        sessionStep: 'PATIENT_SEARCH',
      };
    }

    if (
      cleanText.startsWith('/hold') ||
      cleanText.startsWith('hold_') ||
      cleanText.startsWith('/reserve') ||
      cleanText.startsWith('reserve_')
    ) {
      let raw = cleanText.replace(/^\/?(hold|reserve)[_\s]?/i, '').trim();
      let pharmacyId = 'pharm-bole-01';
      let drugName = session.patientSearchDrug || 'Essential Medicine';

      const pharmMatch = raw.match(/(pharm-[a-z0-9-]+)/i);
      if (pharmMatch) {
        pharmacyId = pharmMatch[1];
        let after = raw.substring(raw.indexOf(pharmacyId) + pharmacyId.length).replace(/^[_\s\-]+/, '').trim();
        if (after) {
          drugName = decodeURIComponent(after);
        }
      } else {
        let parts = raw.includes('_') ? raw.split('_') : raw.split(' ');
        if (parts[0]) pharmacyId = parts[0];
        if (parts.length > 1) drugName = decodeURIComponent(parts.slice(1).join(' '));
      }

      const pharmacy = this.db.pharmacies.find((p) => p.id === pharmacyId) || 
                       this.db.pharmacies.find((p) => p.name.toLowerCase().includes(pharmacyId.toLowerCase())) ||
                       this.db.pharmacies[0];
      const inv = pharmacy.inventory?.find((it) => it.name.toLowerCase().includes(drugName.toLowerCase()));
      const lockedPrice = inv?.priceETB || 320;

      const hold = this.db.createReservationHold({
        patientUserId: chatId,
        pharmacyId: pharmacy.id,
        medicineName: drugName,
        lockedPriceETB: lockedPrice,
        durationMinutes: 60,
      });

      if (!hold) {
        return {
          chatId,
          replyText: `⚠️ ይቅርታ፣ ዋጋ ማስያዝ አልተቻለም። እባክዎ እንደገና ይሞክሩ።\nCould not create reservation hold. Please try again.`,
          quickReplies: ['/start', '💊 Insulin', '💊 Augmentin'],
        };
      }

      const expTime = new Date(hold.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      // Real-time notification to the pharmacy counter!
      if (pharmacy.telegramChatId) {
        this.notifyPharmacyReservationHold({
          pharmacyChatId: pharmacy.telegramChatId,
          pharmacyName: pharmacy.name,
          drugName,
          priceETB: lockedPrice,
          reservationCode: hold.reservationCode,
          expiresAt: expTime,
          patientChatId: chatId,
        }).catch((err) => {
          console.warn('[TelegramBot] Could not alert pharmacy of hold:', err.message);
        });
      }

      const mapsUrl = `https://maps.google.com/?q=${pharmacy.latitude},${pharmacy.longitude}`;

      const replyText = session.language === 'am' ? `
🎟️ **የመድኃኒት ዋጋ ማስያዣ ደረሰኝ (60-Min Price Lock Voucher)**
━━━━━━━━━━━━━━━━━━━━━━━━━━
🔐 **የማስያዣ ቫውቸር ኮድ፦**  \`#${hold.reservationCode}\`
━━━━━━━━━━━━━━━━━━━━━━━━━━
💊 መድኃኒት፦ **${drugName}**
🏥 ፋርማሲ፦ **${pharmacy.name}**
📍 አድራሻ፦ **${pharmacy.subCity} Sub-City**
💰 የተቆለፈ ዋጋ፦ **${lockedPrice} ETB** (በህግ የተረጋገጠ)
⏳ ተቀባይነት ያለው፦ **ለ 60 ደቂቃ ብቻ (እስከ ${expTime})**
📞 የፋርማሲ ስልክ፦ \`${pharmacy.phone}\`
━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 **የካውንተር መመሪያ ለታካሚው፦**
1️⃣ በአንድ ሰዓት (60 ደቂቃ) ውስጥ ወደ ፋርማሲው በአካል ይሂዱ።
2️⃣ ካውንተር ላይ ኮድ \`#${hold.reservationCode}\` ለፋርማሲስቱ ያሳዩ።
3️⃣ በታሸገው **${lockedPrice} ETB** ዋጋ መድኃኒትዎን ይረከቡ!
━━━━━━━━━━━━━━━━━━━━━━━━━━
🛡️ *ማስታወሻ፦ በኢትዮጵያ ምግብና መድኃኒት ባለስልጣን (EFDA) ደንብ መሰረት ፋርማሲው ዋጋ የመጨመርም ሆነ መድኃኒቱን ለሌላ ሰው የመስጠት መብት የለውም።*
` : `
🎟️ **60-Minute Price Lock Reservation Voucher**
━━━━━━━━━━━━━━━━━━━━━━━━━━
🔐 **Voucher Code:**  \`#${hold.reservationCode}\`
━━━━━━━━━━━━━━━━━━━━━━━━━━
💊 Medicine: **${drugName}**
🏥 Pharmacy: **${pharmacy.name}**
📍 Location: **${pharmacy.subCity} Sub-City**
💰 Locked Price: **${lockedPrice} ETB** (Verified Anti-Gouging)
⏳ Valid Duration: **60 Minutes (Until ${expTime})**
📞 Contact: \`${pharmacy.phone}\`
━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 **Patient Instructions:**
1️⃣ Visit the pharmacy counter within 60 minutes.
2️⃣ Present code \`#${hold.reservationCode}\` to the pharmacist.
3️⃣ Pay the locked price of **${lockedPrice} ETB**.
━━━━━━━━━━━━━━━━━━━━━━━━━━
🛡️ *Notice: Protected by EFDA fair pricing regulations. Report any overpricing via /report.*
`;

      return {
        chatId,
        replyText,
        quickReplies: ['💊 ሌላ መድኃኒት ፈልግ', '📍 ክፍለ ከተማ ቀይር', '/start'],
        inlineKeyboard: [
          [
            { text: '🗺️ ወደ ፋርማሲው አቅጣጫ (Google Maps)', url: mapsUrl },
          ],
          [
            { text: '🔄 አዲስ ፍለጋ (Search Another)', callback_data: 'search_new' },
            { text: '📍 ክፍለ ከተማ ቀይር', callback_data: 'subcity_menu' },
          ],
        ],
        sessionStep: 'PATIENT_SEARCH'
      };
    }

    // Acknowledge hold by pharmacist
    if (cleanText.startsWith('ack_hold_')) {
      const code = cleanText.replace(/^ack_hold_/, '');
      return {
        chatId,
        replyText: `✅ **የትዕዛዝ ደረሰኝ ተረጋግጧል! (Hold Acknowledged)**\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n🔐 የማስያዣ ኮድ፦ **#${code}**\n\nታካሚው በአንድ ሰዓት ውስጥ መጥቶ ይህን ኮድ በካውንተር ሲያሳይ መድኃኒቱን ያስረክቡ። እናመሰግናለን! 🏥`,
        quickReplies: ['📦 መደርደሪያዬ (/inventory)', '🖥️ Open Web Studio', '/start'],
        inlineKeyboard: [
          [{ text: '📦 መደርደሪያዬን እይ (/inventory)', callback_data: '/inventory' }],
        ],
        sessionStep: 'PHARMACY_INVENTORY',
      };
    }

    // Interactive new search prompt
    if (cleanText === 'search_new' || cleanText === 'search_another' || cleanText === 'search_start') {
      return {
        chatId,
        replyText: `💊 **መድኃኒት መፈለጊያ (Medicine Search)**\n━━━━━━━━━━━━━━━━━━━━━━━━━━\nየሚፈልጉትን መድኃኒት ስም እዚህ ይጻፉ (ምሳሌ፦ *Insulin*, *Ventolin*, *Augmentin*, *Metformin*...) ወይም ከታች ካሉት አማራጮች አንዱን ይጫኑ፦`,
        quickReplies: [
          '💊 Insulin',
          '💊 Augmentin',
          '💊 Ventolin',
          '💊 Metformin',
          '📍 አቅራቢያዬን ፈልግ (Share GPS)',
          '📍 ክፍለ ከተማ ምረጥ (Sub-City)',
          '/start'
        ],
        inlineKeyboard: [
          [
            { text: '💊 Insulin', callback_data: 'search_Insulin' },
            { text: '💊 Ventolin', callback_data: 'search_Ventolin' },
          ],
          [
            { text: '💊 Augmentin', callback_data: 'search_Augmentin' },
            { text: '💊 Metformin', callback_data: 'search_Metformin' },
          ],
          [
            { text: '📍 ክፍለ ከተማ ምረጥ (Sub-City)', callback_data: 'subcity_menu' },
          ]
        ],
        sessionStep: 'PATIENT_SEARCH',
      };
    }

    // Direct search by drug callback
    if (cleanText.startsWith('search_')) {
      const drugName = cleanText.replace(/^search_/, '').trim();
      session.patientSearchDrug = drugName;
      let lat = session.patientLat || 9.0015;
      let lng = session.patientLng || 38.7845;
      let subCity = session.patientSubCity || 'Kirkos';

      return this.searchMedicineForPatient({
        chatId,
        medicineName: drugName,
        userLat: lat,
        userLng: lng,
        subCityName: subCity,
        lang: session.language || 'am',
      });
    }

    // Sub-city interactive menu
    if (cleanText === 'subcity_menu' || cleanText === '📍 ክፍለ ከተማ ምረጥ (Sub-City)' || cleanText.includes('ክፍለ ከተማ ምረጥ')) {
      return {
        chatId,
        replyText: `📍 **የሚገኙበትን ክፍለ ከተማ ይምረጡ (Select Sub-City)**\n━━━━━━━━━━━━━━━━━━━━━━━━━━\nበአቅራቢያዎ ያሉትን ፋርማሲዎች በትክክል ለማግኘት ከታች ካሉት ይምረጡ፦`,
        quickReplies: [
          '📍 Bole (ቦሌ)',
          '📍 Kirkos (ቂርቆስ)',
          '📍 Yeka (የካ)',
          '📍 Arada (ፒያሳ)',
          '📍 Nifas Silk (ሳሪስ)',
          '📍 Lideta (ልደታ)',
          '/start',
        ],
        inlineKeyboard: [
          [
            { text: '📍 Bole (ቦሌ)', callback_data: 'subcity_Bole' },
            { text: '📍 Kirkos (ቂርቆስ/ሜክሲኮ)', callback_data: 'subcity_Kirkos' },
          ],
          [
            { text: '📍 Yeka (የካ/መገናኛ)', callback_data: 'subcity_Yeka' },
            { text: '📍 Arada (ፒያሳ)', callback_data: 'subcity_Arada' },
          ],
          [
            { text: '📍 Nifas Silk (ሳሪስ)', callback_data: 'subcity_NifasSilk' },
            { text: '📍 Lideta (ልደታ)', callback_data: 'subcity_Lideta' },
          ],
          [
            { text: '📍 Kolfe Keranio (ኮልፌ)', callback_data: 'subcity_Kolfe' },
            { text: '📍 Gullele (ጉለሌ)', callback_data: 'subcity_Gullele' },
          ],
        ],
        sessionStep: 'PATIENT_SEARCH',
      };
    }

    // Sub-city selection callback: subcity_<Name> or subcity_<Name>_<Drug>
    if (cleanText.startsWith('subcity_')) {
      const parts = cleanText.replace(/^subcity_/, '').split('_');
      const subCityRaw = parts[0];
      const drugQuery = parts[1] || session.patientSearchDrug;

      const matchedSubCity = ADDIS_SUB_CITIES.find(sc =>
        sc.name.toLowerCase().replace(/[^a-z]/g, '') === subCityRaw.toLowerCase().replace(/[^a-z]/g, '')
      ) || ADDIS_SUB_CITIES[0];

      session.patientLat = matchedSubCity.lat;
      session.patientLng = matchedSubCity.lng;
      session.patientSubCity = matchedSubCity.name;

      if (drugQuery) {
        session.patientSearchDrug = drugQuery;
        return this.searchMedicineForPatient({
          chatId,
          medicineName: drugQuery,
          userLat: matchedSubCity.lat,
          userLng: matchedSubCity.lng,
          subCityName: matchedSubCity.name,
          lang: session.language || 'am',
        });
      }

      return {
        chatId,
        replyText: `📍 **የተመረጠ ክፍለ ከተማ፦ ${matchedSubCity.name}** ✅\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n💊 እባክዎ የሚፈልጉትን መድኃኒት ስም ይጻፉ ወይም ከታች ካሉት አንዱን ይምረጡ፦`,
        quickReplies: [
          '💊 Insulin',
          '💊 Augmentin',
          '💊 Ventolin',
          '💊 Metformin',
          '📍 ክፍለ ከተማ ቀይር',
          '/start'
        ],
        inlineKeyboard: [
          [
            { text: '💊 Insulin', callback_data: `search_Insulin` },
            { text: '💊 Ventolin', callback_data: `search_Ventolin` },
          ],
          [
            { text: '💊 Augmentin', callback_data: `search_Augmentin` },
            { text: '💊 Metformin', callback_data: `search_Metformin` },
          ],
        ],
        sessionStep: 'PATIENT_SEARCH',
      };
    }

    // Help for adding medicine
    if (cleanText === 'help_add') {
      return {
        chatId,
        replyText: `➕ **አዲስ መድኃኒት ወደ መደርደሪያ ለመጨመር**\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n👉 በቀላሉ የመድኃኒቱን ስም እና ዋጋ በብር ይጻፉ፦\n\nምሳሌ፦ \`/add Amoxicillin 85\`\nወይም፦ \`/add Insulin 450\`\n\nወዲያውኑ ወደ መደርደሪያዎ ገብቶ ለታካሚዎች ይታያል!`,
        quickReplies: ['➕ /add Amoxicillin 85', '➕ /add Insulin 450', '📦 መደርደሪያዬ (/inventory)'],
        inlineKeyboard: [
          [{ text: '📦 መደርደሪያዬን እይ (/inventory)', callback_data: '/inventory' }],
        ],
        sessionStep: 'PHARMACY_INVENTORY',
      };
    }

    if (cleanText === '/status') {
      const existing = this.db.verificationApplications.filter((a) => a.telegramChatId === chatId);
      if (existing.length === 0) {
        return {
          chatId,
          replyText: `ℹ️ ምንም የተመዘገበ ማመልከቻ የለም። ለመጀመር /verify ብለው ይጻፉ።\nNo verification application found. Type /verify to begin.`,
          quickReplies: ['/verify', '/start'],
        };
      }
      const latest = existing[0];
      const statusAm = latest.status === 'APPROVED' 
        ? '✅ ጸድቋል (Approved - Verified Shield Active)' 
        : latest.status === 'REJECTED' 
          ? '❌ ውድቅ ተደርጓል (Rejected)' 
          : latest.status === 'INFO_REQUESTED'
            ? 'ℹ️ ተጨማሪ ሰነድ ተጠይቋል (Action Required - Info Requested)'
            : latest.status === 'RESUBMITTED'
              ? '🔄 ታድሶ በግምገማ ላይ (Resubmitted - Pending Re-Review)'
              : '⏳ በግምገማ ላይ ነው (Pending Review)';
      return {
        chatId,
        replyText: `📋 **የማመልከቻ ሁኔታ / Application Status**\n\n• ቁጥር (ID): **${latest.id}**\n• ፋርማሲ፦ **${latest.pharmacyName}**\n• አድራሻ (Location): **${latest.subCity}** ${latest.gpsLocationVerified ? '🟢 (GPS Locked)' : ''}\n• የEFDA ፈቃድ፦ **${latest.efdaLicenseNumber}**\n• ሁኔታ፦ **${statusAm}**\n• የገመገመው ቡድን ማስታወሻ፦ ${latest.adminNotes || 'Cross-referencing with EFDA iRIS registry.'}`,
        quickReplies: latest.status === 'INFO_REQUESTED' ? ['📸 አዲስ ፎቶ ላክ', '/verify', '/help'] : ['/verify', '/help'],
      };
    }

    // ==========================================
    // PHARMACY INVENTORY & STOCK MANAGEMENT (CHANNEL 2)
    // ==========================================

    // Link/Claim pharmacy management in chat
    if (cleanText.startsWith('/manage') || cleanText.startsWith('/link_pharmacy')) {
      let pharmId = cleanText.replace(/^\/(manage|link_pharmacy)[_\s]?/, '').trim();
      if (cleanText.includes('Kenema') || cleanText.includes('Bole')) pharmId = 'pharm-bole-01';
      else if (cleanText.includes('Aster') || cleanText.includes('Mexico')) pharmId = 'pharm-mexico-05';
      else if (cleanText.includes('Lion') || cleanText.includes('Megenagna')) pharmId = 'pharm-megenagna-02';
      else if (cleanText.includes('Buraq') || cleanText.includes('Piazza')) pharmId = 'pharm-piazza-03';
      else if (cleanText.includes('Saris')) pharmId = 'pharm-saris-04';

      const pharmacy = this.db.pharmacies.find((p) => p.id === pharmId) || this.db.pharmacies[0];
      pharmacy.telegramChatId = chatId;
      session.mode = 'PHARMACY';
      session.data.pharmacyName = pharmacy.name;

      return {
        chatId,
        replyText: `✅ **ፋርማሲዎ በተሳካ ሁኔታ ተገናኝቷል!**\n\n• ፋርማሲ፦ **${pharmacy.name}**\n• አድራሻ፦ **${pharmacy.subCity} Sub-City**\n• የEFDA ፈቃድ፦ **${pharmacy.efdaLicenseNumber}**\n\nአሁን የፋርማሲዎን የመድኃኒት ክምችት በቀጥታ በዚህ ቦት ወይም በWeb Studio ማስተዳደር ይችላሉ።\n\n👉 ክምችት ለማየትና ለማስተካከል፦ **/inventory**\n👉 15ቱን ዋና መድኃኒቶች ለመጫን፦ **/import_checklist**`,
        quickReplies: ['/inventory', '/import_checklist', '➕ /add Amoxicillin 85', '🖥️ Open Web Studio', '/start'],
        inlineKeyboard: [
          [{ text: '🖥️ Open Web Pharmacy Studio', url: this.getWebStudioUrl(pharmacy.id) }]
        ],
        sessionStep: 'PHARMACY_INVENTORY',
      };
    }

    // 1-Click Essential List Import
    if (cleanText === '/import_checklist' || cleanText.includes('1-Click Essential List') || cleanText.includes('ቼክሊስት ጫን')) {
      const pharmacy = this.getPharmacyForChatId(chatId);
      if (!pharmacy) {
        return this.promptLinkPharmacy(chatId);
      }

      const items = MASTER_MEDICINE_CATALOG.map((c) => ({
        name: c.name,
        genericName: c.genericName,
        category: c.category,
        priceETB: c.defaultPriceETB,
      }));

      const count = this.db.bulkImportChecklist(pharmacy.id, items);

      return {
        chatId,
        replyText: `🎉 **15ቱ ዋና ዋና የኢትዮጵያ መድኃኒቶች ወደ መደርደሪያዎ ገብተዋል!**\n**Successfully Imported ${count} Essential Medicines!**\n\n• ፋርማሲ፦ **${pharmacy.name}** (${pharmacy.subCity})\n• የተካተቱ መድኃኒቶች፦ Insulin, Augmentin, Ventolin, Metformin, Eltroxin, Amlodipine, Losartan, Ceftriaxone, Paracetamol, etc.\n• ሁሉም መድኃኒቶች በነባሪ [🟢 In Stock] ሆነው ተመዝግበዋል።\n\nዋጋዎችን ለማስተካከል ወይም ያለቀባቸውን ለመቀየር 👉 **/inventory** ይጫኑ።`,
        quickReplies: ['/inventory', '➕ /add Coartem 150', '🖥️ Open Web Studio', '/start'],
        inlineKeyboard: [
          [{ text: '🖥️ Open Web Pharmacy Studio (Full Editor)', url: this.getWebStudioUrl(pharmacy.id) }]
        ],
        sessionStep: 'PHARMACY_INVENTORY',
      };
    }

    // Quick Add Single Item: /add <Name> <Price>
    if (cleanText.startsWith('/add ') || cleanText.startsWith('/add_')) {
      const pharmacy = this.getPharmacyForChatId(chatId);
      if (!pharmacy) {
        return this.promptLinkPharmacy(chatId);
      }

      const cleanCmd = cleanText.replace(/^\/add[_\s]+/, '').trim();
      const lastSpaceIdx = cleanCmd.lastIndexOf(' ') > 0 ? cleanCmd.lastIndexOf(' ') : cleanCmd.lastIndexOf('_');

      let drugName = '';
      let price = 0;

      if (lastSpaceIdx > 0) {
        drugName = cleanCmd.substring(0, lastSpaceIdx).trim();
        price = parseFloat(cleanCmd.substring(lastSpaceIdx + 1).trim());
      } else {
        drugName = cleanCmd;
        price = 150;
      }

      if (!drugName || isNaN(price)) {
        return {
          chatId,
          replyText: `⚠️ እባክዎ የመድኃኒቱን ስም እና ዋጋ በብር በትክክል ይጻፉ (ምሳሌ፦ \`/add Amoxicillin 85\` ወይንም \`/add Insulin 450\`)።`,
          quickReplies: ['/inventory', '/import_checklist', '/help'],
        };
      }

      this.db.addOrUpdateMedicine(pharmacy.id, {
        name: drugName,
        priceETB: price,
        category: 'General',
        inStock: true,
      });

      return {
        chatId,
        replyText: `✅ **መድኃኒት በመደርደሪያዎ ላይ ተመዝግቧል!**\n\n• ፋርማሲ፦ **${pharmacy.name}**\n• መድኃኒት፦ **${drugName}**\n• የችርቻሮ ዋጋ፦ **${price} ETB**\n• ሁኔታ፦ **🟢 በክምችት አለ (In Stock)**\n\nበአቅራቢያዎ ያሉ ታካሚዎች ይህን መድኃኒት ሲፈልጉ ወዲያውኑ ያገኙዎታል።\n👉 ሙሉ ክምችት ለማየት፦ **/inventory**`,
        quickReplies: ['/inventory', '/import_checklist', '➕ /add Metformin 120', '🖥️ Open Web Studio'],
        inlineKeyboard: [
          [{ text: '🖥️ Open Web Pharmacy Studio', url: this.getWebStudioUrl(pharmacy.id) }]
        ],
        sessionStep: 'PHARMACY_INVENTORY',
      };
    }

    // Toggle In-Stock / Out-of-Stock: /toggle_<ItemName>
    if (cleanText.startsWith('/toggle') || cleanText.startsWith('/stock_toggle')) {
      const pharmacy = this.getPharmacyForChatId(chatId);
      if (!pharmacy) {
        return this.promptLinkPharmacy(chatId);
      }

      const rawItemName = cleanText.replace(/^\/(toggle|stock_toggle)[_\s]?/, '').trim();
      if (!rawItemName) {
        return {
          chatId,
          replyText: `ℹ️ ክምችት ለመቀየር ከመድኃኒቱ ስም ጋር ይጻፉ (ምሳሌ፦ \`/toggle_Insulin\`)\nወይም በ **/inventory** በኩል የመድኃኒቱን ሊንክ ይጫኑ።`,
          quickReplies: ['/inventory'],
        };
      }

      const item = pharmacy.inventory.find(
        (i) =>
          i.name.toLowerCase() === rawItemName.toLowerCase() ||
          i.name.toLowerCase().includes(rawItemName.toLowerCase()) ||
          rawItemName.toLowerCase().includes(i.name.toLowerCase().split(' ')[0])
      );

      if (!item) {
        return {
          chatId,
          replyText: `⚠️ "${rawItemName}" የተባለ መድኃኒት በመደርደሪያዎ ላይ አልተገኘም።\n👉 አዲስ ለመመዝገብ፦ \`/add ${rawItemName} 100\`\n👉 ሙሉ ክምችት ለማየት፦ /inventory`,
          quickReplies: ['/inventory', '/import_checklist'],
        };
      }

      const newStockStatus = !item.inStock;
      this.db.toggleMedicineStock(pharmacy.id, item.name, newStockStatus);

      const statusTextAm = newStockStatus ? '🟢 በክምችት አለ (In Stock)' : '🔴 ክምችት አልቋል (Out of Stock)';
      return {
        chatId,
        replyText: `🔄 **የክምችት ሁኔታ ተቀይሯል! (Stock Updated)**\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n• ፋርማሲ፦ **${pharmacy.name}**\n• መድኃኒት፦ **${item.name}**\n• አዲሱ ሁኔታ፦ **${statusTextAm}**\n• ዋጋ፦ **${item.priceETB} ETB**\n━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        quickReplies: ['/inventory', '/import_checklist', '🖥️ Open Web Studio'],
        inlineKeyboard: [
          [{ text: '📦 መደርደሪያዬን እይ (/inventory)', callback_data: '/inventory' }],
          [{ text: '🖥️ Open Web Pharmacy Studio', url: this.getWebStudioUrl(pharmacy.id) }]
        ],
        sessionStep: 'PHARMACY_INVENTORY',
      };
    }

    // View Complete Shelf Inventory: /inventory or /stock or /shelf
    if (cleanText === '/inventory' || cleanText === '/stock' || cleanText === '/shelf' || cleanText.includes('የክምችት ማስተዳደሪያ') || cleanText.includes('መደርደሪያዬ')) {
      const pharmacy = this.getPharmacyForChatId(chatId);
      if (!pharmacy) {
        return this.promptLinkPharmacy(chatId);
      }

      session.mode = 'PHARMACY';
      const items = pharmacy.inventory || [];
      const inStockCount = items.filter((i) => i.inStock).length;
      const outOfStockCount = items.filter((i) => !i.inStock).length;

      let itemsDisplay = '';
      const inlineKeyboard: Array<Array<{ text: string; callback_data?: string; url?: string }>> = [];

      if (items.length === 0) {
        itemsDisplay = `⚠️ በመደርደሪያዎ ላይ የተመዘገበ መድኃኒት የለም።\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n👉 15ቱን ዋና መድኃኒቶች በአንድ ጊዜ ለመጫን ከታች ያለውን **[📦 1-Click Essential List]** ይጫኑ\n👉 ወይም በነጠላ ለመጨመር \`/add <ስም> <ዋጋ>\` ይጻፉ።`;
      } else {
        itemsDisplay = items
          .slice(0, 8)
          .map((i, idx) => {
            const num = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣'][idx] || '🔹';
            const bullet = i.inStock ? '🟢' : '🔴';
            const statusLabel = i.inStock ? 'In Stock' : 'Out of Stock';
            return `${num} ${bullet} **${i.name}**\n   💵 **${i.priceETB} ETB**  |  🏷️ *${i.category || 'General'}*  |  📦 *${statusLabel}*`;
          })
          .join('\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

        if (items.length > 8) {
          itemsDisplay += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n*(...እና ተጨማሪ ${items.length - 8} መድኃኒቶች በWeb Studio ይገኛሉ)*`;
        }

        // Add 1-click toggle buttons for the first 4 items!
        const toggleRow1: any[] = [];
        const toggleRow2: any[] = [];
        items.slice(0, 4).forEach((it, idx) => {
          const shortName = it.name.split(' ')[0].replace(/[^a-zA-Z0-9]/g, '');
          const btn = {
            text: `${it.inStock ? '🟢' : '🔴'} ${idx + 1}. ${shortName} ቀይር`,
            callback_data: `/toggle_${shortName}`,
          };
          if (idx < 2) toggleRow1.push(btn);
          else toggleRow2.push(btn);
        });

        if (toggleRow1.length > 0) inlineKeyboard.push(toggleRow1);
        if (toggleRow2.length > 0) inlineKeyboard.push(toggleRow2);
      }

      // Add management utility buttons
      inlineKeyboard.push([
        { text: '📦 15 ዋና መድኃኒቶች ጫን', callback_data: '/import_checklist' },
        { text: '➕ መድኃኒት መዝግብ (/add)', callback_data: 'help_add' },
      ]);
      inlineKeyboard.push([
        { text: '🖥️ Open Web Pharmacy Studio (Excel & Bulk)', url: this.getWebStudioUrl(pharmacy.id) }
      ]);

      const text = `🏪 **${pharmacy.name} — የክምችት ዝርዝር (Shelf Inventory)**
📍 **${pharmacy.subCity}** • 🛡️ \`EFDA Verified Partner\` • ⭐ **${pharmacy.trustScore}% Trust**
━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 **የክምችት ማጠቃለያ (Stock Summary)**
• አጠቃላይ የተመዘገቡ፦ **${items.length}**
• በክምችት ያሉ፦ **${inStockCount} 🟢**  |  ያለቁ፦ **${outOfStockCount} 🔴**
━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 **የመደርደሪያ ዝርዝር (Shelf Items):**
${itemsDisplay}
━━━━━━━━━━━━━━━━━━━━━━━━━━
⚡ **ፈጣን ማስተካከያ፦** ከታች ያሉትን ቁልፎች በመጫን የክምችት ሁኔታን በ1-ክሊክ ይቀይሩ ወይም አዳዲስ መድኃኒቶችን ይጫኑ።`;

      return {
        chatId,
        replyText: text,
        quickReplies: [
          '/import_checklist',
          '➕ /add Amoxicillin 85',
          '/inventory',
          '🖥️ Open Web Studio',
          '/start'
        ],
        inlineKeyboard,
        sessionStep: 'PHARMACY_INVENTORY',
      };
    }

    if (cleanText === '/help') {
      return {
        chatId,
        replyText: `📖 **MedFinder Ethiopia — ፈጣን መመሪያ (Guide)**\n\n💊 **ለመድኃኒት ፈላጊዎች (Patients):**\n• የመድኃኒት ስም በቀጥታ በመጻፍ ይፈልጉ (ምሳሌ፦ *Insulin*)\n• በአቅራቢያዎ ያሉ ፋርማሲዎችን፣ ትክክለኛ ዋጋ እና ስልክ ያግኙ\n• ለ60 ደቂቃ ዋጋውን ለማስያዝ የ /hold ቁልፍን ይጫኑ\n• ሚኒ አፑን ለመክፈት 👉 **/miniapp**\n\n🏥 **ለፋርማሲዎች (Pharmacies):**\n• ይፋዊ ማረጋገጫ ለማግኘት 👉 **/verify**\n• የማመልከቻዎን ሁኔታ ለማየት 👉 **/status**\n• የመድኃኒት መደርደሪያዎን ለማየትና ለመቆጣጠር 👉 **/inventory**\n• 15ቱን ዋና መድኃኒቶች በቅጽበት ለመጫን 👉 **/import_checklist**\n• አዲስ መድኃኒት ለመጨመር 👉 **/add <ስም> <ዋጋ>** (ምሳሌ፦ \`/add Amoxicillin 85\`)\n• ክምችት አለቀ/ገባ ለማለት 👉 **/toggle_<ስም>** (ምሳሌ፦ \`/toggle_Insulin\`)`,
        quickReplies: ['💊 Insulin', '/inventory', '/import_checklist', '📱 Open Mini App', '/verify', '/status'],
        inlineKeyboard: [
          [{ text: '📱 Open Telegram Mini App', web_app: { url: this.getMiniAppUrl() } }],
          [{ text: '🖥️ Open Web Pharmacy Studio', url: this.getWebStudioUrl() }]
        ]
      };
    }


    // --- CHECK FOR RESUBMISSION / INFO UPDATE FROM PHARMACIST ---
    const waitingApp = this.db.verificationApplications.find(
      (a) => a.telegramChatId === chatId && (a.status === 'INFO_REQUESTED' || a.id === session?.updatingApplicationId)
    );

    if (waitingApp && (session.step === 'AWAITING_INFO_UPDATE' || waitingApp.status === 'INFO_REQUESTED' || photoUrl || documentUrl)) {
      let updateSummary = '';

      if (photoUrl || documentUrl) {
        const newMedia = photoUrl || documentUrl;
        this.db.resubmitVerificationApplication(waitingApp.id, {
          photoUrl: newMedia,
          note: 'Pharmacist uploaded updated Certificate of Competence photo via Telegram',
        });
        updateSummary = session.language === 'am'
          ? `📸 አዲሱ የብቃት ማረጋገጫ (CoC) ፎቶ በተሳካ ሁኔታ ተቀብለናል!`
          : `📸 New Certificate of Competence photo successfully received!`;
      } else if (location) {
        const parsedLoc = parseLocationOrAddress(cleanText || '', location);
        this.db.resubmitVerificationApplication(waitingApp.id, {
          location: {
            latitude: parsedLoc.latitude,
            longitude: parsedLoc.longitude,
            subCity: parsedLoc.subCity,
            addressDetails: parsedLoc.addressDetails,
          },
          note: `Pharmacist updated physical GPS location: ${parsedLoc.subCity} (${parsedLoc.latitude}, ${parsedLoc.longitude})`,
        });
        updateSummary = session.language === 'am'
          ? `📍 የተስተካከለው የፋርማሲ ጂፒኤስ አድራሻ ተመዝግቧል (${parsedLoc.subCity})!`
          : `📍 Updated pharmacy GPS location recorded (${parsedLoc.subCity})!`;
      } else if (cleanText.toUpperCase().includes('EFDA') || cleanText.toUpperCase().includes('TIN')) {
        const isEFDA = cleanText.toUpperCase().includes('EFDA');
        this.db.resubmitVerificationApplication(waitingApp.id, {
          efdaLicenseNumber: isEFDA ? cleanText : undefined,
          tinNumber: !isEFDA ? cleanText : undefined,
          note: `Pharmacist updated ${isEFDA ? 'EFDA License' : 'TIN'} number to: ${cleanText}`,
        });
        updateSummary = session.language === 'am'
          ? `✍️ የተስተካከለው ቁጥር (${cleanText}) በማመልከቻዎ ላይ ተመዝግቧል!`
          : `✍️ Updated registration number (${cleanText}) recorded!`;
      } else {
        this.db.resubmitVerificationApplication(waitingApp.id, {
          note: `Applicant note: "${cleanText}"`,
        });
        updateSummary = session.language === 'am'
          ? `📝 የሰጡት ማብራሪያ በማመልከቻዎ ላይ ተካቷል!`
          : `📝 Your written explanation has been attached to your application!`;
      }

      session.step = 'START';
      session.updatingApplicationId = undefined;

      const reply = session.language === 'am'
        ? `
✅ **ማመልከቻዎ በተሳካ ሁኔታ ታድሶ ተልኳል!**
**Application Resubmitted Successfully!**

${updateSummary}

• የማመልከቻ መለያ፦ **${waitingApp.id}** (${waitingApp.pharmacyName})
• ሁኔታ፦ **🔄 እንደገና በግምገማ ላይ (Resubmitted - Pending Review)**

የMedFinder የቁጥጥር ቡድን (Compliance Desk) የላኩትን አዲስ መረጃ በፍጥነት አይቶ ውሳኔ ይሰጣል። 
ሁኔታውን ለመከታተል 👉 **/status** ብለው ይጻፉ።
`
        : `
✅ **Application Resubmitted Successfully!**

${updateSummary}

• Application ID: **${waitingApp.id}** (${waitingApp.pharmacyName})
• Status: **🔄 Resubmitted - Pending Review**

The EFDA Compliance Desk has been notified of your updated submission and will review it promptly.
Type **/status** at any time to monitor progress.
`;

      return {
        chatId,
        replyText: reply,
        quickReplies: ['/status', '/help'],
        sessionStep: 'START',
      };
    }

    // ==========================================
    // PATIENT MEDICINE SEARCH & LOCATION HANDLING
    // ==========================================
    if (session.mode !== 'PHARMACY') {
      const isChangeLocation = cleanText.includes('Change Location') || cleanText.includes('ቀይር');
      const cleanSubCityMatch = ADDIS_SUB_CITIES.find((sc) =>
        cleanText.toLowerCase().replace(/[📍💊\s]/g, '') === sc.name.toLowerCase().replace(/\s/g, '') ||
        sc.keywords.some((k) => cleanText.toLowerCase().replace(/[📍💊\s]/g, '') === k.replace(/\s/g, ''))
      );

      if (isChangeLocation) {
        return {
          chatId,
          replyText: `📍 እባክዎ አዲስ አድራሻ ወይም ክፍለ ከተማ ይምረጡ፦\nPlease choose your location:`,
          quickReplies: [
            '📍 የኔን ጂፒኤስ ላክ (Share GPS)',
            '📍 Bole',
            '📍 Kirkos (Mexico)',
            '📍 Yeka (Megenagna)',
            '📍 Arada (Piazza)',
            '📍 Nifas Silk (Saris)',
            '📍 Lideta',
          ],
          inlineKeyboard: [
            [{ text: '📱 Open Telegram Mini App', web_app: { url: this.getMiniAppUrl() } }]
          ],
          sessionStep: 'AWAITING_SEARCH_LOCATION',
        };
      }

      if (location || cleanSubCityMatch || cleanText.includes('Share GPS') || cleanText.includes('የኔን ጂፒኤስ ላክ')) {
        let lat = 9.0015;
        let lng = 38.7845;
        let subCity = 'Bole';

        if (location) {
          lat = location.latitude;
          lng = location.longitude;
          subCity = detectSubCityFromCoordinates(lat, lng);
        } else if (cleanSubCityMatch) {
          lat = cleanSubCityMatch.lat;
          lng = cleanSubCityMatch.lng;
          subCity = cleanSubCityMatch.name;
        }

        session.patientLat = lat;
        session.patientLng = lng;
        session.patientSubCity = subCity;

        const drugToSearch = session.patientSearchDrug || 'Insulin';
        return this.searchMedicineForPatient({
          chatId,
          medicineName: drugToSearch,
          userLat: lat,
          userLng: lng,
          subCityName: subCity,
          lang: session.language || 'am',
        });
      }

      // Check if text looks like a medicine name query
      const drugQuery = cleanText.replace(/^[💊📍\s]+/, '').trim();
      const isKnownSubCity = ADDIS_SUB_CITIES.some((sc) => sc.name.toLowerCase() === drugQuery.toLowerCase());

      if (
        drugQuery.length >= 2 &&
        !drugQuery.startsWith('/') &&
        !isKnownSubCity &&
        !drugQuery.startsWith('1.') &&
        !drugQuery.startsWith('2.')
      ) {
        session.patientSearchDrug = drugQuery;

        // If user already shared/selected location
        if (session.patientLat && session.patientLng) {
          return this.searchMedicineForPatient({
            chatId,
            medicineName: drugQuery,
            userLat: session.patientLat,
            userLng: session.patientLng,
            subCityName: session.patientSubCity || 'Bole',
            lang: session.language || 'am',
          });
        }

        // Location not set yet -> ask user to share GPS or choose sub-city
        return {
          chatId,
          replyText: `📍 ለ **"${drugQuery}"** በአቅራቢያዎ ያሉ የተረጋገጡ ፋርማሲዎችን ለመፈለግ እባክዎ አድራሻዎን ያጋሩ፦\n\n1️⃣ ከታች ያለውን **"📍 የኔን ጂፒኤስ ላክ (Share GPS)"** ይጫኑ\n2️⃣ ወይም በአቅራቢያዎ ያለውን ክፍለ ከተማ ይምረጡ፦`,
          quickReplies: [
            '📍 የኔን ጂፒኤስ ላክ (Share GPS)',
            '📍 Bole',
            '📍 Kirkos (Mexico)',
            '📍 Yeka (Megenagna)',
            '📍 Arada (Piazza)',
            '📍 Nifas Silk (Saris)',
            '📍 Lideta',
          ],
          inlineKeyboard: [
            [{ text: '📱 Open Telegram Mini App', web_app: { url: this.getMiniAppUrl() } }]
          ],
          sessionStep: 'AWAITING_SEARCH_LOCATION',
        };
      }
    }

    // Default patient fallback
    session.step = 'PATIENT_SEARCH';
    const miniAppUrl = this.getMiniAppUrl();
    return {
      chatId,
      replyText: `🇪🇹 **እንኳን ወደ MedFinder ኢትዮጵያ የመድኃኒት መፈለጊያ በደህና መጡ!**
━━━━━━━━━━━━━━━━━━━━━━━━━━
የሚፈልጉትን መድኃኒት ስም እዚህ ይጻፉ (ለምሳሌ፦ *Insulin*, *Augmentin*, *Ventolin*) ወይም ከታች ካሉት ፈጣን አማራጮች ይምረጡ፦`,
      quickReplies: ['💊 Insulin', '💊 Augmentin', '💊 Ventolin', '📍 ክፍለ ከተማ ምረጥ (Sub-City)', '/start'],
      inlineKeyboard: [
        [
          { text: '💊 Insulin', callback_data: 'search_Insulin' },
          { text: '💊 Ventolin', callback_data: 'search_Ventolin' },
        ],
        [
          { text: '📍 ክፍለ ከተማ ምረጥ (Sub-City)', callback_data: 'subcity_menu' },
        ]
      ],
      sessionStep: 'PATIENT_SEARCH',
    };
  }

  /**
   * Step-by-step accreditation state machine for @MedFinder_Verifier_bot
   */
  private processAccreditationStep(
    session: TelegramBotSession,
    cleanText: string,
    photoUrl?: string,
    documentUrl?: string,
    location?: { latitude: number; longitude: number },
    chatId: string = ''
  ): TelegramBotResponse {
    switch (session.step) {
      case 'LANGUAGE': {
        session.language = cleanText.includes('English') || cleanText === '2' ? 'en' : 'am';
        session.step = 'PHARMACY_NAME';

        const prompt = session.language === 'am'
          ? `🏢 **ደረጃ 1 ከ 6፦ የፋርማሲ ስም**\n━━━━━━━━━━━━━━━━━━━━━━━━━━\nእባክዎ በንግድ ፈቃድዎ ላይ የተመዘገበውን ይፋዊ የፋርማሲ ስም ይጻፉ (ምሳሌ፦ *አቢሲኒያ ጤና አጠባበቅ ፋርማሲ*):`
          : `🏢 **Step 1 of 6: Pharmacy Name**\n━━━━━━━━━━━━━━━━━━━━━━━━━━\nPlease enter the official registered name of your pharmacy (e.g. *Abyssinia Health Care Pharmacy*):`;

        return {
          chatId,
          replyText: prompt,
          sessionStep: 'PHARMACY_NAME',
        };
      }

      case 'PHARMACY_NAME': {
        if (!cleanText || cleanText.length < 3) {
          return {
            chatId,
            replyText: `⚠️ እባክዎ ትክክለኛ የፋርማሲ ስም ያስገቡ (ቢያንስ 3 ፊደላት)።\nPlease enter a valid pharmacy name.`,
          };
        }
        session.data.pharmacyName = cleanText;
        session.step = 'LOCATION_GPS';

        const prompt = session.language === 'am'
          ? `📍 **ደረጃ 2 ከ 6፦ የፋርማሲውን ትክክለኛ አድራሻ (Location) ያጋሩ**\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n⚠️ **አድራሻን በእጅ መጻፍ አያስፈልግም!** ከሚከተሉት አንዱን ያድርጉ፦\n\n1️⃣ ከታች ያለውን **"📍 Share Current GPS Location"** የሚለውን ቁልፍ ይጫኑ\n2️⃣ ወይም የፋርማሲዎን **Google Maps ሊንክ** ወይንም **ኮፒ የተደረገ አድራሻ** እዚህ ፔስት (Paste) ያድርጉ:`
          : `📍 **Step 2 of 6: Pharmacy Physical Location & GPS**\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n⚠️ **Notice:** Manual typing is not required. Please choose one:\n\n1️⃣ Tap **"📍 Share Current GPS Location"** below\n2️⃣ Or **Copy & Paste your Google Maps link** or address here:`;

        return {
          chatId,
          replyText: prompt,
          quickReplies: [
            '📍 Share Current GPS Location / ቦታዬን በጂፒኤስ ላክ',
            'Paste: https://maps.google.com/?q=9.0015,38.7845 (Bole)',
            'Paste: https://maps.google.com/?q=9.0105,38.7455 (Kirkos / Mexico)',
            'Paste: https://maps.google.com/?q=9.0201,38.8021 (Yeka / Megenagna)',
            'Paste: https://maps.google.com/?q=9.0345,38.7512 (Arada / Piazza)',
            'Paste: https://maps.google.com/?q=8.9567,38.7612 (Nifas Silk / Saris)',
          ],
          sessionStep: 'LOCATION_GPS',
        };
      }

      case 'LOCATION_GPS': {
        const parsed = parseLocationOrAddress(cleanText, location);
        session.data.subCity = parsed.subCity;
        session.data.latitude = parsed.latitude;
        session.data.longitude = parsed.longitude;
        session.data.addressDetails = parsed.addressDetails;
        session.data.gpsLocationVerified = parsed.isVerifiedGps;
        session.step = 'PHONE';

        const verifiedBadge = parsed.isVerifiedGps
          ? (session.language === 'am' ? '🟢 ትክክለኛ ጂፒኤስ ተረጋግጧል (GPS Auto-Locked)' : '🟢 Precise GPS Locked')
          : (session.language === 'am' ? '📋 ኮፒ የተደረገ አድራሻ ተመዝግቧል' : '📋 Copied Address Logged');

        const prompt = session.language === 'am'
          ? `✅ **አድራሻዎ ተመዝግቧል!** (${verifiedBadge})\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n• ክፍለ ከተማ፦ **${parsed.subCity}**\n• ዝርዝር፦ ${parsed.addressDetails}\n\n📞 **ደረጃ 3 ከ 6፦ የእውቂያ ስልክ ቁጥር**\nለታካሚዎች እና ለአስቸኳይ ጥሪ የሚሆን የፋርማሲውን ስልክ ቁጥር ያስገቡ (ምሳሌ፦ *+251911223344*):`
          : `✅ **Location Verified!** (${verifiedBadge})\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n• Detected Sub-City: **${parsed.subCity}**\n• Coordinates/Address: ${parsed.addressDetails}\n\n📞 **Step 3 of 6: Contact Phone Number**\nEnter the official counter phone number (e.g. *+251911223344*):`;

        return {
          chatId,
          replyText: prompt,
          sessionStep: 'PHONE',
        };
      }

      case 'PHONE': {
        session.data.phone = cleanText || '+251911000000';
        session.step = 'PHARMACIST_INFO';

        const prompt = session.language === 'am'
          ? `👨‍⚕️ **ደረጃ 4 ከ 6፦ ኃላፊ ፋርማሲስት / ድራጊስት**\n━━━━━━━━━━━━━━━━━━━━━━━━━━\nእባክዎ የኃላፊውን ፋርማሲስት ሙሉ ስም እና የሙያ ፈቃድ ቁጥር ያስገቡ (ምሳሌ፦ *Solomon Tesfaye - EPA-RPH-2024-8190*):`
          : `👨‍⚕️ **Step 4 of 6: Lead Pharmacist / Druggist**\n━━━━━━━━━━━━━━━━━━━━━━━━━━\nEnter lead pharmacist's full name and license number (e.g. *Solomon Tesfaye - EPA-RPH-2024-8190*):`;

        return {
          chatId,
          replyText: prompt,
          sessionStep: 'PHARMACIST_INFO',
        };
      }

      case 'PHARMACIST_INFO': {
        session.data.pharmacistName = cleanText;
        session.data.pharmacistLicenseNumber = cleanText.includes('-') ? cleanText.split('-')[1]?.trim() : 'EPA-RPH-2024-VALID';
        session.step = 'EFDA_LICENSE';

        const prompt = session.language === 'am'
          ? `📜 **ደረጃ 5 ከ 6፦ የEFDA ብቃት ማረጋገጫ (CoC) ፈቃድ ቁጥር እና ፎቶ**\n━━━━━━━━━━━━━━━━━━━━━━━━━━\nየኢትዮጵያ ምግብና መድኃኒት ባለስልጣን (EFDA) የብቃት ማረጋገጫ ቁጥር ያስገቡ (ምሳሌ፦ *EFDA/PH/AA/2024/9912*) ወይም የሰነዱን ፎቶ ይላኩ:`
          : `📜 **Step 5 of 6: EFDA Certificate of Competence (CoC)**\n━━━━━━━━━━━━━━━━━━━━━━━━━━\nEnter your EFDA license number (e.g. *EFDA/PH/AA/2024/9912*) or upload photo of the wall certificate:`;

        return {
          chatId,
          replyText: prompt,
          quickReplies: ['EFDA/PH/AA/2024/9912', 'EFDA/PH/AA/2025/1104'],
          sessionStep: 'EFDA_LICENSE',
        };
      }

      case 'EFDA_LICENSE': {
        const isPhotoAttached = Boolean(photoUrl || documentUrl) || cleanText.includes('[Wall Certificate') || cleanText.startsWith('[');
        const extractedNumber = cleanText.includes('EFDA') 
          ? cleanText 
          : (isPhotoAttached ? 'EFDA/PH/AA/2024/' + Math.floor(1000 + Math.random() * 9000) : (cleanText || 'EFDA/PH/AA/2024/8890'));
        
        session.data.efdaLicenseNumber = extractedNumber;
        session.data.efdaDocUrl = photoUrl || documentUrl || session.data.efdaDocUrl || 'https://images.unsplash.com/photo-1589829545856-d10d557cf95f?auto=format&fit=crop&w=800&q=80';
        session.step = 'TIN_NUMBER';

        const prompt = session.language === 'am'
          ? `🏛️ **ደረጃ 6 ከ 6፦ የታክስ ከፋይ መለያ (TIN ቁጥር)**\n━━━━━━━━━━━━━━━━━━━━━━━━━━\nየንግድ ምዝገባ TIN ቁጥርዎን ያስገቡ (ምሳሌ፦ *TIN-0019283741*):`
          : `🏛️ **Step 6 of 6: Taxpayer Identification Number (TIN)**\n━━━━━━━━━━━━━━━━━━━━━━━━━━\nEnter your business TIN number (e.g. *TIN-0019283741*):`;

        return {
          chatId,
          replyText: prompt,
          quickReplies: ['TIN-0019283741', 'TIN-0028471923'],
          sessionStep: 'TIN_NUMBER',
        };
      }

      case 'TIN_NUMBER': {
        session.data.tinNumber = cleanText.replace(/[^0-9A-Za-z-]/g, '') || '0019283741';
        if (photoUrl) session.data.counterPhotoUrl = photoUrl;
        if (!session.data.counterPhotoUrl) {
          session.data.counterPhotoUrl = 'https://images.unsplash.com/photo-1586015554060-705b6375005b?auto=format&fit=crop&w=800&q=80';
        }
        session.step = 'CONFIRM';

        const summary = `
📋 **የማመልከቻ ማጠቃለያ / Verification Summary**
━━━━━━━━━━━━━━━━━━━━━━━━━━
• **ፋርማሲ (Pharmacy):** ${session.data.pharmacyName}
• **አድራሻ (Location):** ${session.data.subCity}, Addis Ababa ${session.data.gpsLocationVerified ? '🟢 (GPS Locked)' : '📋 (Pasted)'}
• **የቦታው ዝርዝር:** ${session.data.addressDetails || 'Direct GPS Coordinates'}
• **ስልክ (Phone):** ${session.data.phone}
• **ኃላፊ ባለሙያ (Pharmacist):** ${session.data.pharmacistName}
• **የEFDA ፈቃድ (CoC):** ${session.data.efdaLicenseNumber}
• **TIN ቁጥር:** ${session.data.tinNumber}
━━━━━━━━━━━━━━━━━━━━━━━━━━
ሁሉንም መረጃዎች አረጋግጠው ለማስገባት **"አረጋግጥ"** ወይም **"Confirm"** ብለው ይላኩ።
Send **"Confirm"** to submit to the EFDA Compliance Desk.`;

        return {
          chatId,
          replyText: summary,
          quickReplies: ['አረጋግጥ (Confirm Submission)', 'ይቅር / Cancel'],
          sessionStep: 'CONFIRM',
        };
      }

      case 'CONFIRM': {
        if (cleanText.toLowerCase().includes('cancel') || cleanText.includes('ይቅር')) {
          session.step = 'START';
          return {
            chatId,
            replyText: `🚫 ማመልከቻው ተሰርዟል። እንደገና ለመጀመር /verify ይጫኑ።\nApplication cancelled. Type /verify to restart.`,
            quickReplies: ['/verify'],
          };
        }

        // Create Official Application Packet
        const app = this.db.submitVerificationApplication({
          telegramChatId: chatId,
          telegramUsername: session.username,
          pharmacyName: session.data.pharmacyName || 'Registered Pharmacy',
          subCity: session.data.subCity || 'Bole',
          addressDetails: session.data.addressDetails,
          latitude: session.data.latitude,
          longitude: session.data.longitude,
          gpsLocationVerified: session.data.gpsLocationVerified,
          phone: session.data.phone || '+251911000000',
          pharmacistName: session.data.pharmacistName || 'Licensed Pharmacist',
          pharmacistLicenseNumber: session.data.pharmacistLicenseNumber || 'EPA-RPH-2024-VALID',
          efdaLicenseNumber: session.data.efdaLicenseNumber || 'EFDA/PH/AA/2024/9912',
          tinNumber: session.data.tinNumber || 'TIN-0011223344',
          counterPhotoUrl: session.data.counterPhotoUrl,
          efdaDocUrl: session.data.efdaDocUrl,
          adminNotes: 'Awaiting MedFinder Compliance Desk cross-check with EFDA iRIS portal.',
        });

        // Reset session
        session.step = 'START';
        session.data = {};

        const successMsg = `
🎉 **ማመልከቻዎ በተሳካ ሁኔታ ገብቷል!**
**Application Successfully Submitted!**
━━━━━━━━━━━━━━━━━━━━━━━━━━
• የማመልከቻ መለያ ቁጥር (Application ID): **${app.id}**
• አድራሻ፦ **${app.subCity}** ${app.gpsLocationVerified ? '🟢 (Exact GPS Linked)' : ''}
• ሁኔታ (Status): **⏳ በግምገማ ላይ (Pending EFDA Review)**

የMedFinder የቁጥጥር እና ተገዢነት ቡድን (Compliance Desk) የሰነድዎን ትክክለኛነት ከEFDA iRIS ቋት ጋር በ24 ሰዓታት ውስጥ በማረጋገጥ አረንጓዴውን **EFDA Verified** ባጅ ያነቃል። 

ውጤቱ ሲታወቅ በዚህ ቦት ላይ ፈጣን ማሳወቂያ ይደርስዎታል። በማንኛውም ጊዜ ሁኔታውን ለመከታተል 👉 **/status** ብለው መጻፍ ይችላሉ።
`;

        return {
          chatId,
          replyText: successMsg,
          quickReplies: ['/status', '/help'],
          isComplete: true,
          applicationId: app.id,
        };
      }

      default: {
        session.step = 'START';
        return {
          chatId,
          replyText: `ሰላም! ማረጋገጫ ለመጀመር እባክዎ /verify ይጫኑ።\nWelcome! Please type /verify to start your pharmacy accreditation.`,
          quickReplies: ['/verify', '/status', '/start'],
        };
      }
    }
  }

  /**
   * Send notification to pharmacy when compliance review decision is made
   */
  public async notifyReviewDecision(chatId: string, status: 'APPROVED' | 'REJECTED' | 'INFO_REQUESTED', adminNotes?: string): Promise<boolean> {
    let message = '';
    const app = this.db.verificationApplications.find((a) => a.telegramChatId === chatId);
    const pharmId = app?.approvedPharmacyId || 'pharm-bole-01';
    const webStudioUrl = this.getWebStudioUrl(pharmId);

    if (status === 'APPROVED') {
      message = `
🎉 **እንኳን ደስ አለዎት! ማረጋገጫዎ ጸድቋል!**
**CONGRATULATIONS! Your Pharmacy is Verified!**

የኢትዮጵያ ምግብና መድኃኒት ባለስልጣን (EFDA) የብቃት ማረጋገጫዎ በተሳካ ሁኔታ ተረጋግጧል። 

✅ **የተሰጡ ጥቅሞች፦**
• **EFDA Verified Shield (የታመነ አረንጓዴ ባጅ)** በመገለጫዎ ላይ ነቅቷል።
• የፋርማሲዎ ትክክለኛ ጂፒኤስ እና የመድኃኒት ክምችት በታካሚዎች የፍለጋ ራዳር ላይ በቅድሚያ ይታያል።
• አጣዳፊ የሆኑ የመድኃኒት ጥያቄዎችን በቅጽበት መመለስ ይችላሉ።

━━━━━━━━━━━━━━━━━━━━━━
📦 **ቀጣዩ ደረጃ፦ የመድኃኒት መደርደሪያዎን ይመዝግቡ (Manage Shelf Inventory)**
በአቅራቢያዎ ያሉ ታካሚዎች መድኃኒቶችዎን በቀጥታ እንዲያገኙ የመድኃኒት ዝርዝርዎን ያስገቡ፦
1️⃣ 15ቱን ዋና ዋና መድኃኒቶች በቅጽበት ለመጫን 👉 **/import_checklist**
2️⃣ መደርደሪያዎን ለማየትና ለመቆጣጠር 👉 **/inventory**
3️⃣ አዲስ መድኃኒት ለመጨመር 👉 **/add <ስም> <ዋጋ>** (ምሳሌ፦ \`/add Amoxicillin 85\`)
4️⃣ ወይም የExcel ፋይልዎን ለመጫን ከታች ያለውን የWeb Studio ሊንክ ይጠቀሙ 👇
━━━━━━━━━━━━━━━━━━━━━━
ማስታወሻ፦ ${adminNotes || 'CoC verified against EFDA iRIS registry.'}
`;
    } else if (status === 'REJECTED') {
      message = `
⚠️ **የማረጋገጫ ጥያቄዎ ውድቅ ተደርጓል**
**Application Rejected**

የቀረበው የEFDA የብቃት ማረጋገጫ ወይም የንግድ ፈቃድ ከባለስልጣኑ መዝገብ ጋር አልተጣጣመም።
ምክንያት፦ ${adminNotes || 'License details could not be matched with EFDA registry.'}

እባክዎ ትክክለኛውን ሰነድ ይዘው በ /verify በኩል እንደገና ያመልክቱ።
`;
    } else {
      message = `
ℹ️ **ተጨማሪ ሰነድ / ማስተካከያ ተጠይቋል (Action Required)**
**EFDA Compliance Desk Information Request**

ለፋርማሲ፦ **${app?.pharmacyName || 'Your Pharmacy'}** (${app?.id || ''})

📌 **የተጠየቀው ማብራሪያ / ሰነድ (Requested by Officer):**
"${adminNotes || 'Please upload a clearer picture of your Certificate of Competence (CoC).'}"

━━━━━━━━━━━━━━━━━━━━━━
📸 **እንዴት ማሟላት ይችላሉ? (How to Submit Update):**
1. **አዲስ ፎቶ ለመላክ፦** የጠራ የCoC ምስክር ወረቀት ወይም ካውንተር ፎቶ በቀጥታ በዚህ ቻት ይላኩ 📸
2. **ቁጥር ለማስተካከል፦** ትክክለኛውን የEFDA ፈቃድ ወይም TIN ቁጥር ይጻፉ ✍️
3. **አድራሻ ለመቀየር፦** ትክክለኛውን የቦታ ጂፒኤስ ወይም አድራሻ ይላኩ 📍
━━━━━━━━━━━━━━━━━━━━━━
አዲሱ መረጃ እንደደረሰን ማመልከቻዎ ወዲያውኑ ታድሶ ለግምገማ ይቀርባል።
`;
    }

    const token = this.pharmacyBot.token || this.patientBot.token;
    const isMockChat = typeof chatId === 'string' && (chatId.startsWith('tg_') || !/^(-?\d+|@[\w]+)$/.test(chatId));
    if (token && !isMockChat) {
      try {
        const formattedMessage = message.replace(/\*\*(.*?)\*\*/g, '*$1*');
        const payload: any = {
          chat_id: chatId,
          text: formattedMessage,
          parse_mode: 'Markdown',
        };

        if (status === 'APPROVED') {
          if (webStudioUrl.startsWith('https://') || (webStudioUrl.startsWith('http://') && !webStudioUrl.includes('localhost'))) {
            payload.reply_markup = {
              inline_keyboard: [
                [{ text: '🖥️ Open Web Pharmacy Studio (Excel & Bulk)', url: webStudioUrl }]
              ]
            };
          } else {
            payload.reply_markup = {
              keyboard: [
                [{ text: '/inventory' }, { text: '/import_checklist' }],
                [{ text: '➕ /add Amoxicillin 85' }],
                [{ text: '/start' }]
              ],
              resize_keyboard: true,
            };
          }
        } else if (status === 'INFO_REQUESTED') {
          payload.reply_markup = {
            keyboard: [
              [{ text: '📸 አዲስ ፎቶ ላክ (Send Photo)' }],
              [{ text: '📍 ቦታዬን በጂፒኤስ ላክ (Share GPS)', request_location: true }],
              [{ text: '/status' }, { text: '/help' }],
            ],
            resize_keyboard: true,
            one_time_keyboard: true,
          };
        }

        let res = await dispatchTelegramApi(token, 'sendMessage', payload);
        if (!res.ok && res.description && !res.description.includes('chat not found')) {
          console.warn('[TelegramBot] notifyReviewDecision rejected, sending plain text fallback:', res.description);
          await dispatchTelegramApi(token, 'sendMessage', { chat_id: chatId, text: message.replace(/[*_`]/g, '') });
        }
      } catch (err: any) {
        console.error('[TelegramBot] Failed to dispatch real Telegram message:', err.message);
      }
    }

    return true;
  }
}

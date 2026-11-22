import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../../common/config/configuration';
import { SmsProvider } from './sms-provider';

/**
 * Renflair WhatsApp OTP delivery. As with the other providers, OtpService
 * generates and verifies the code; this only delivers it.
 *
 * Request shape taken from Renflair's own sample script (send-otp.php):
 *   GET {base}/V1.php?API=<key>&PHONE=<10-digit>&OTP=<code>&COUNTRY=91
 * The message text and the app name shown in it are fixed by Renflair and its
 * dashboard ("App / Website Name"), not by us.
 *
 * ⚠ Things to know / verify before production:
 *   - The API key AND the code travel in the URL query string (Renflair's
 *     design). Over HTTPS, but they will appear in Renflair's server logs. We
 *     therefore NEVER log the URL, the key, the number or the code, and refuse
 *     redirects so the key can't be forwarded elsewhere.
 *   - The response is not documented; the success shape was observed on a real
 *     send (scripts/send-test-otp.ts): {"message":"Message Successfully
 *     Delivered","status":"SUCCESS"}. Failure shapes are NOT observed, so
 *     anything other than status=SUCCESS is treated as a failure.
 *   - Renflair is a non-DLT reseller: confirm on a real phone what sender and
 *     wording customers will see.
 */
@Injectable()
export class RenflairProvider extends SmsProvider {
  private readonly logger = new Logger(RenflairProvider.name);
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(configService: ConfigService<AppConfig, true>) {
    super();
    const cfg = configService.get('otp', { infer: true }).renflair;
    this.apiKey = cfg.apiKey;
    this.baseUrl = cfg.baseUrl.replace(/\/+$/, '');
  }

  async sendOtp(phoneE164: string, code: string): Promise<void> {
    if (!this.apiKey) {
      throw new Error('Renflair is not configured (RENFLAIR_API_KEY)');
    }
    const match = /^\+(91)([6-9]\d{9})$/.exec(phoneE164);
    if (!match) {
      throw new Error('Renflair supports Indian (+91) numbers only');
    }

    const url = new URL(`${this.baseUrl}/V1.php`);
    url.searchParams.set('API', this.apiKey);
    url.searchParams.set('PHONE', match[2]);
    url.searchParams.set('OTP', code);
    url.searchParams.set('COUNTRY', match[1]);

    let status: number;
    let text: string;
    try {
      const res = await fetch(url, {
        method: 'GET',
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      });
      status = res.status;
      text = await res.text();
    } catch {
      // Deliberately not logging the error: its message/cause can embed the URL.
      this.logger.error('Renflair OTP send failed (network error)');
      throw new Error('WhatsApp delivery failed');
    }

    if (status < 200 || status >= 300 || RenflairProvider.isFailure(text)) {
      this.logger.error(`Renflair OTP send failed (HTTP ${status})`);
      throw new Error('WhatsApp delivery failed');
    }
  }

  /**
   * Fail closed: only an explicit `{"status":"SUCCESS"}` (the shape Renflair
   * returned on a real send: {"message":"Message Successfully Delivered",
   * "status":"SUCCESS"}) counts as delivered. Anything else — non-JSON, a
   * missing or different status, an error body — is a failure.
   */
  private static isFailure(body: string): boolean {
    try {
      const json: unknown = JSON.parse(body);
      if (json === null || typeof json !== 'object') return true;
      const status = (json as Record<string, unknown>).status;
      return !(
        typeof status === 'string' && status.trim().toLowerCase() === 'success'
      );
    } catch {
      return true;
    }
  }
}

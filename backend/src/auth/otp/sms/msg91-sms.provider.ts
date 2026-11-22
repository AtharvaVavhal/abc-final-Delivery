import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../../common/config/configuration';
import { SmsProvider } from './sms-provider';

/**
 * MSG91 OTP delivery (DLT-approved template). We pass our own `otp` value so
 * that generation/expiry/verification stay in OtpService; MSG91 only delivers.
 *
 * ⚠ VERIFY BEFORE PRODUCTION: the request shape below follows MSG91's v5 OTP
 * endpoint as described by third-party SDKs (`POST /api/v5/otp` with
 * `template_id`, `mobile` in international format without "+", and `otp`).
 * MSG91's official docs were not reachable when this was written, and sources
 * disagree on whether `authkey` goes in a header or a query parameter. Confirm
 * against the current MSG91 docs and a real DLT template on staging. Only this
 * file changes if the shape differs.
 */
@Injectable()
export class Msg91SmsProvider extends SmsProvider {
  private readonly logger = new Logger(Msg91SmsProvider.name);
  private readonly authKey: string;
  private readonly templateId: string;
  private readonly baseUrl: string;

  constructor(configService: ConfigService<AppConfig, true>) {
    super();
    const cfg = configService.get('otp', { infer: true }).msg91;
    this.authKey = cfg.authKey;
    this.templateId = cfg.templateId;
    this.baseUrl = cfg.baseUrl.replace(/\/+$/, '');
  }

  async sendOtp(phoneE164: string, code: string): Promise<void> {
    if (!this.authKey || !this.templateId) {
      throw new Error(
        'MSG91 is not configured (MSG91_AUTH_KEY / MSG91_OTP_TEMPLATE_ID)',
      );
    }
    const params = new URLSearchParams({
      template_id: this.templateId,
      mobile: phoneE164.replace(/^\+/, ''),
      otp: code,
    });
    const res = await fetch(`${this.baseUrl}/api/v5/otp?${params.toString()}`, {
      method: 'POST',
      headers: { authkey: this.authKey, 'content-type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await res.json().catch(() => ({}))) as { type?: string };
    // MSG91 can answer HTTP 200 with {"type":"error"} — treat that as failure.
    if (!res.ok || body.type === 'error') {
      // Never log the code, the number or the auth key.
      this.logger.error(
        `MSG91 OTP send failed (HTTP ${res.status}, type=${body.type ?? 'n/a'})`,
      );
      throw new Error('SMS delivery failed');
    }
  }
}

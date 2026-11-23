import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../../common/config/configuration';
import { SmsProvider } from './sms-provider';

/**
 * MSG91 WhatsApp OTP delivery (authentication template). As with SMS, the code
 * is generated/verified by OtpService; this only delivers it.
 *
 * Request shape taken from MSG91's "WhatsApp OTP" help page (Sample API
 * Request): `POST {base}/api/v5/whatsapp/whatsapp-outbound-message/bulk/`,
 * `authkey` header, JSON body with `integrated_number`, a `template` payload
 * (`name`, `namespace`, `language`) and `to_and_components`, where the OTP goes
 * in `body_1` and — for authentication templates — the `button_1` copy-code
 * button.
 *
 * ⚠ VERIFY BEFORE PRODUCTION (not stated by MSG91's page, so assumed here):
 *   - recipient format: sent as digits with country code, no "+" (91XXXXXXXXXX);
 *   - the success/error response body: only a non-2xx status or a body with
 *     `type`/`status` of "error"/"fail" is treated as failure;
 *   - whether the approved template has the copy-code button (set
 *     MSG91_WHATSAPP_INCLUDE_BUTTON=false if it does not).
 * Meta also restricts authentication templates to eligible accounts (business
 * verification / higher messaging tier) — confirm eligibility with MSG91.
 */
@Injectable()
export class Msg91WhatsAppProvider extends SmsProvider {
  private readonly logger = new Logger(Msg91WhatsAppProvider.name);
  private readonly authKey: string;
  private readonly baseUrl: string;
  private readonly integratedNumber: string;
  private readonly templateName: string;
  private readonly templateNamespace: string;
  private readonly languageCode: string;
  private readonly includeButton: boolean;

  constructor(configService: ConfigService<AppConfig, true>) {
    super();
    const cfg = configService.get('otp', { infer: true }).msg91;
    this.authKey = cfg.authKey;
    this.baseUrl = cfg.baseUrl.replace(/\/+$/, '');
    this.integratedNumber = cfg.whatsapp.integratedNumber;
    this.templateName = cfg.whatsapp.templateName;
    this.templateNamespace = cfg.whatsapp.templateNamespace;
    this.languageCode = cfg.whatsapp.languageCode;
    this.includeButton = cfg.whatsapp.includeButton;
  }

  async sendOtp(phoneE164: string, code: string): Promise<void> {
    if (
      !this.authKey ||
      !this.integratedNumber ||
      !this.templateName ||
      !this.templateNamespace
    ) {
      throw new Error('MSG91 WhatsApp is not configured');
    }

    const components: Record<string, unknown> = {
      body_1: { type: 'text', value: code },
    };
    if (this.includeButton) {
      components.button_1 = { subtype: 'url', type: 'text', value: code };
    }

    const res = await fetch(
      `${this.baseUrl}/api/v5/whatsapp/whatsapp-outbound-message/bulk/`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authkey: this.authKey,
        },
        body: JSON.stringify({
          integrated_number: this.integratedNumber,
          content_type: 'template',
          payload: {
            messaging_product: 'whatsapp',
            type: 'template',
            template: {
              name: this.templateName,
              language: { code: this.languageCode, policy: 'deterministic' },
              namespace: this.templateNamespace,
              to_and_components: [
                {
                  to: [phoneE164.replace(/^\+/, '')],
                  components,
                },
              ],
            },
          },
        }),
        signal: AbortSignal.timeout(10_000),
      },
    );

    const body = (await res.json().catch(() => ({}))) as {
      type?: string;
      status?: string;
    };
    const failed =
      !res.ok ||
      body.type === 'error' ||
      body.status === 'error' ||
      body.status === 'fail';
    if (failed) {
      // Never log the code, the number or the auth key.
      this.logger.error(
        `MSG91 WhatsApp OTP send failed (HTTP ${res.status}, type=${body.type ?? 'n/a'}, status=${body.status ?? 'n/a'})`,
      );
      throw new Error('WhatsApp delivery failed');
    }
  }
}

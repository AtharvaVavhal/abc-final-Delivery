import { Injectable, Logger } from '@nestjs/common';
import { SmsProvider } from './sms-provider';

/** Dev/test only: logs the code instead of sending it. Refused in production
 * by env validation and by the module factory. */
@Injectable()
export class ConsoleSmsProvider extends SmsProvider {
  private readonly logger = new Logger(ConsoleSmsProvider.name);

  sendOtp(phoneE164: string, code: string): Promise<void> {
    this.logger.warn(`[DEV OTP] ${phoneE164} → ${code}`);
    return Promise.resolve();
  }
}

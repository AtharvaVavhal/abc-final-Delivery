import { Injectable, Logger } from '@nestjs/common';
import { SmsProvider } from './sms-provider';

/** Dev/test delivery sink. Refused in production
 * by env validation and by the module factory. */
@Injectable()
export class ConsoleSmsProvider extends SmsProvider {
  private readonly logger = new Logger(ConsoleSmsProvider.name);

  sendOtp(_phoneE164: string, _code: string): Promise<void> {
    this.logger.warn('OTP delivery sink active; no message delivered');
    return Promise.resolve();
  }
}

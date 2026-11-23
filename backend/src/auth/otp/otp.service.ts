import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { createHmac, randomInt, timingSafeEqual } from 'crypto';
import { AppConfig } from '../../common/config/configuration';
import { PrismaService } from '../../common/database/prisma.service';
import {
  OTP_CAP_ALERT_FRACTION,
  OTP_CODE_LENGTH,
  OTP_IP_WINDOW_MAX,
  OTP_IP_WINDOW_MS,
  OTP_MAX_VERIFY_ATTEMPTS,
  OTP_PHONE_DAY_MAX,
  OTP_PHONE_WINDOW_MAX,
  OTP_PHONE_WINDOW_MS,
  OTP_RESEND_COOLDOWN_MS,
  OTP_RETENTION_MS,
  OTP_TTL_MS,
} from './otp.constants';
import { maskPhone, normalizeIndianMobile } from './phone.util';
import { SmsProvider } from './sms/sms-provider';

const INVALID_CODE_MESSAGE = 'Invalid or expired code';

/**
 * Issues and verifies SMS codes. Codes are generated here (CSPRNG), stored only
 * as an HMAC, single-use, 5-minute, max 5 attempts. The SMS provider only
 * delivers. requestCode() never reveals whether a number has an account.
 */
@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);
  private readonly enabled: boolean;
  private readonly hmacSecret: string;
  private readonly dailySendCap: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly smsProvider: SmsProvider,
    configService: ConfigService<AppConfig, true>,
  ) {
    const cfg = configService.get('otp', { infer: true });
    this.enabled = cfg.enabled;
    this.hmacSecret = cfg.hmacSecret;
    this.dailySendCap = cfg.dailySendCap;
    if (this.enabled && !this.hmacSecret) {
      throw new Error('AUTH_OTP_ENABLED=true requires OTP_HMAC_SECRET');
    }
  }

  /** The feature flag: while off, the OTP routes behave as if they don't exist. */
  assertEnabled(): void {
    if (!this.enabled) throw new NotFoundException();
  }

  async requestCode(
    rawPhone: string,
    ip: string | undefined,
    storeId: string,
  ): Promise<void> {
    this.assertEnabled();
    const phone = normalizeIndianMobile(rawPhone);
    if (!phone) {
      throw new BadRequestException(
        'Enter a valid 10-digit Indian mobile number',
      );
    }

    if (!storeId) throw new UnauthorizedException(INVALID_CODE_MESSAGE);
    // Reserve send budget across every API instance before calling the provider.
    // This short transaction never holds a connection during an SMS request.
    const { challenge, code } = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(731920461)`;
      const now = Date.now();
      const since = (ms: number) => new Date(now - ms);
      const startOfUtcDay = new Date(now);
      startOfUtcDay.setUTCHours(0, 0, 0, 0);

      const [lastForPhone, phoneWindow, phoneDay, ipWindow, globalToday] =
        await Promise.all([
          tx.otpChallenge.findFirst({
            where: { phoneE164: phone },
            orderBy: { createdAt: 'desc' },
            select: { createdAt: true },
          }),
          tx.otpChallenge.count({
            where: {
              phoneE164: phone,
              createdAt: { gte: since(OTP_PHONE_WINDOW_MS) },
            },
          }),
          tx.otpChallenge.count({
            where: {
              phoneE164: phone,
              createdAt: { gte: since(24 * 60 * 60_000) },
            },
          }),
          ip
            ? tx.otpChallenge.count({
                where: {
                  requestIp: ip,
                  createdAt: { gte: since(OTP_IP_WINDOW_MS) },
                },
              })
            : Promise.resolve(0),
          tx.otpChallenge.count({
            where: { createdAt: { gte: startOfUtcDay } },
          }),
        ]);

      if (globalToday >= this.dailySendCap) {
        this.logger.error(
          `OTP daily send cap (${this.dailySendCap}) reached — refusing sends`,
        );
        throw new ServiceUnavailableException(
          'Sign-in by one-time code is temporarily unavailable',
        );
      }
      if (
        globalToday + 1 >=
        Math.floor(this.dailySendCap * OTP_CAP_ALERT_FRACTION)
      ) {
        this.logger.warn(
          `OTP daily send cap ${globalToday + 1}/${this.dailySendCap} (>=80%)`,
        );
      }

      if (
        lastForPhone &&
        now - lastForPhone.createdAt.getTime() < OTP_RESEND_COOLDOWN_MS
      ) {
        throw this.tooMany(
          'Please wait a moment before requesting another code',
        );
      }
      if (
        phoneWindow >= OTP_PHONE_WINDOW_MAX ||
        phoneDay >= OTP_PHONE_DAY_MAX ||
        ipWindow >= OTP_IP_WINDOW_MAX
      ) {
        throw this.tooMany('Too many code requests. Please try again later');
      }

      const code = randomInt(0, 10 ** OTP_CODE_LENGTH)
        .toString()
        .padStart(OTP_CODE_LENGTH, '0');
      // A resend permanently supersedes all previous challenges in this store.
      await tx.otpChallenge.updateMany({
        where: { phoneE164: phone, storeId, consumedAt: null },
        data: { consumedAt: new Date(now) },
      });
      const challenge = await tx.otpChallenge.create({
        data: {
          phoneE164: phone,
          storeId,
          codeHash: this.hashCode(storeId, phone, code),
          expiresAt: new Date(now + OTP_TTL_MS),
          requestIp: ip ?? null,
        },
      });
      return { challenge, code };
    });

    try {
      await this.smsProvider.sendOtp(phone, code);
    } catch {
      // The row still counts toward limits; just make sure it can't be used.
      await this.prisma.otpChallenge.update({
        where: { id: challenge.id },
        data: { consumedAt: new Date() },
      });
      this.logger.error(`OTP delivery failed for ${maskPhone(phone)}`);
      throw new ServiceUnavailableException(
        'Could not send the code. Please try again',
      );
    }
  }

  /** Returns the verified E.164 number. Throws a generic 401 on any failure. */
  async verifyCode(
    rawPhone: string,
    code: string,
    storeId: string,
  ): Promise<string> {
    this.assertEnabled();
    const phone = normalizeIndianMobile(rawPhone);
    if (!phone || !storeId || !/^\d{6}$/.test(code))
      throw new UnauthorizedException(INVALID_CODE_MESSAGE);

    // Return a failure value so an incorrect attempt commits instead of rolling
    // back when the caller receives its generic 401.
    const accepted = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(731920461)`;
      const challenge = await tx.otpChallenge.findFirst({
        where: {
          phoneE164: phone,
          storeId,
        },
        orderBy: { createdAt: 'desc' },
      });
      if (
        !challenge ||
        challenge.consumedAt ||
        challenge.expiresAt.getTime() <= Date.now() ||
        challenge.attempts >= OTP_MAX_VERIFY_ATTEMPTS
      )
        return false;

      // Atomically spend an attempt before comparing, so concurrent guesses
      // cannot exceed the attempt budget.
      const spent = await tx.otpChallenge.updateMany({
        where: {
          id: challenge.id,
          consumedAt: null,
          expiresAt: { gt: new Date() },
          attempts: { lt: OTP_MAX_VERIFY_ATTEMPTS },
        },
        data: { attempts: { increment: 1 } },
      });
      if (spent.count !== 1) return false;

      const expected = Buffer.from(challenge.codeHash, 'hex');
      const actual = Buffer.from(this.hashCode(storeId, phone, code), 'hex');
      const matches =
        expected.length === actual.length && timingSafeEqual(expected, actual);
      if (!matches) return false;

      // Single use: only one concurrent verifier can flip consumedAt.
      const consumed = await tx.otpChallenge.updateMany({
        where: {
          id: challenge.id,
          consumedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: { consumedAt: new Date() },
      });
      return consumed.count === 1;
    });
    if (!accepted) throw new UnauthorizedException(INVALID_CODE_MESSAGE);

    return phone;
  }

  @Cron(CronExpression.EVERY_HOUR)
  async purgeOldChallenges(): Promise<void> {
    if (!this.enabled) return;
    await this.prisma.otpChallenge.deleteMany({
      where: { createdAt: { lt: new Date(Date.now() - OTP_RETENTION_MS) } },
    });
  }

  private hashCode(storeId: string, phoneE164: string, code: string): string {
    return createHmac('sha256', this.hmacSecret)
      .update(`${storeId}:${phoneE164}:${code}`)
      .digest('hex');
  }

  private tooMany(message: string): HttpException {
    return new HttpException(message, HttpStatus.TOO_MANY_REQUESTS);
  }
}

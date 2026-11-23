import { ConfigService } from '@nestjs/config';
import {
  BadRequestException,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { OtpService } from './otp.service';
import { SmsProvider } from './sms/sms-provider';
import {
  OTP_MAX_VERIFY_ATTEMPTS,
  OTP_RESEND_COOLDOWN_MS,
  OTP_TTL_MS,
} from './otp.constants';

interface Row {
  id: string;
  phoneE164: string;
  storeId: string;
  codeHash: string;
  expiresAt: Date;
  attempts: number;
  consumedAt: Date | null;
  requestIp: string | null;
  createdAt: Date;
}

/** Minimal in-memory stand-in for the otpChallenge delegate (only what OtpService uses). */
function fakePrisma() {
  const rows: Row[] = [];
  let seq = 0;
  const match = (r: Row, w: Record<string, any> = {}): boolean =>
    Object.entries(w).every(([k, v]) => {
      const val = (r as any)[k];
      if (v && typeof v === 'object' && !(v instanceof Date)) {
        if ('gte' in v && !(val >= v.gte)) return false;
        if ('gt' in v && !(val > v.gt)) return false;
        if ('lt' in v && !(val < v.lt)) return false;
        return true;
      }
      return val === v;
    });
  const otpChallenge = {
    rows,
    findFirst: ({ where, orderBy }: any) => {
      const found = rows.filter((r) => match(r, where));
      if (orderBy?.createdAt === 'desc')
        found.sort((a, b) => +b.createdAt - +a.createdAt);
      return Promise.resolve(found[0] ?? null);
    },
    count: ({ where }: any) =>
      Promise.resolve(rows.filter((r) => match(r, where)).length),
    create: ({ data }: any) => {
      const row: Row = {
        id: `c${++seq}`,
        attempts: 0,
        consumedAt: null,
        requestIp: null,
        createdAt: new Date(),
        ...data,
      };
      rows.push(row);
      return Promise.resolve(row);
    },
    update: ({ where, data }: any) => {
      const row = rows.find((r) => r.id === where.id)!;
      Object.assign(row, data);
      return Promise.resolve(row);
    },
    updateMany: ({ where, data }: any) => {
      const hit = rows.filter((r) => match(r, where));
      hit.forEach((r) => {
        if (data.attempts?.increment) r.attempts += data.attempts.increment;
        if (data.consumedAt) r.consumedAt = data.consumedAt;
      });
      return Promise.resolve({ count: hit.length });
    },
    deleteMany: () => Promise.resolve({ count: 0 }),
  };
  const tx = { otpChallenge, $executeRaw: jest.fn().mockResolvedValue(1) };
  return {
    ...tx,
    $transaction: (fn: (client: typeof tx) => unknown) => fn(tx),
  };
}

function build(
  overrides: Partial<{ enabled: boolean; cap: number; failSms: boolean }> = {},
) {
  const prisma = fakePrisma();
  const sent: Array<{ phone: string; code: string }> = [];
  const sms: SmsProvider = {
    sendOtp: (phone: string, code: string) => {
      if (overrides.failSms) return Promise.reject(new Error('boom'));
      sent.push({ phone, code });
      return Promise.resolve();
    },
  };
  const config = {
    get: () => ({
      enabled: overrides.enabled ?? true,
      provider: 'console',
      hmacSecret: 'test-secret',
      dailySendCap: overrides.cap ?? 500,
      msg91: {},
    }),
  } as unknown as ConfigService<any, true>;
  const service = new OtpService(prisma as any, sms, config);
  return { service, prisma, sent };
}

/** Moves a challenge back in time so cooldown/window checks can be passed. */
const age = (row: Row, ms: number) => {
  row.createdAt = new Date(row.createdAt.getTime() - ms);
};

describe('OtpService', () => {
  describe('feature flag', () => {
    it('404s both steps while disabled', async () => {
      const { service } = build({ enabled: false });
      await expect(
        service.requestCode('9876543210', '1.1.1.1', 'store-a'),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        service.verifyCode('9876543210', '123456', 'store-a'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuses to start enabled without an HMAC secret', () => {
      const config = {
        get: () => ({ enabled: true, hmacSecret: '', dailySendCap: 500 }),
      } as unknown as ConfigService<any, true>;
      expect(() => new OtpService({} as any, {} as any, config)).toThrow(
        /OTP_HMAC_SECRET/,
      );
    });
  });

  describe('requestCode', () => {
    it('rejects a malformed number without sending', async () => {
      const { service, sent } = build();
      await expect(
        service.requestCode('12345', '1.1.1.1', 'store-a'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(sent).toHaveLength(0);
    });

    it('sends a 6-digit code to the normalised number and stores only a hash', async () => {
      const { service, prisma, sent } = build();
      await service.requestCode('98765 43210', '1.1.1.1', 'store-a');
      expect(sent).toHaveLength(1);
      expect(sent[0].phone).toBe('+919876543210');
      expect(sent[0].code).toMatch(/^\d{6}$/);
      const row = prisma.otpChallenge.rows[0];
      expect(row.codeHash).not.toContain(sent[0].code);
      expect(row.codeHash).toMatch(/^[0-9a-f]{64}$/);
      expect(
        row.expiresAt.getTime() - row.createdAt.getTime(),
      ).toBeLessThanOrEqual(OTP_TTL_MS);
    });

    it('enforces the resend cooldown', async () => {
      const { service } = build();
      await service.requestCode('9876543210', '1.1.1.1', 'store-a');
      await expect(
        service.requestCode('9876543210', '1.1.1.1', 'store-a'),
      ).rejects.toMatchObject({ status: 429 });
    });

    it('limits sends per number (3 per 15 min)', async () => {
      const { service, prisma } = build();
      for (let i = 0; i < 3; i++) {
        await service.requestCode('9876543210', `10.0.0.${i}`, 'store-a');
        age(prisma.otpChallenge.rows[i], OTP_RESEND_COOLDOWN_MS + 1);
      }
      await expect(
        service.requestCode('9876543210', '10.0.0.9', 'store-a'),
      ).rejects.toMatchObject({ status: 429 });
    });

    it('limits sends per IP across different numbers', async () => {
      const { service, prisma } = build();
      for (let i = 0; i < 20; i++) {
        await service.requestCode(
          `98765432${String(i).padStart(2, '0')}`,
          '5.5.5.5',
          'store-a',
        );
        age(prisma.otpChallenge.rows[i], OTP_RESEND_COOLDOWN_MS + 1);
      }
      await expect(
        service.requestCode('9999999999', '5.5.5.5', 'store-a'),
      ).rejects.toMatchObject({ status: 429 });
    });

    it('stops sending at the global daily cap', async () => {
      const { service, sent } = build({ cap: 2 });
      await service.requestCode('9876543210', '1.1.1.1', 'store-a');
      await service.requestCode('9876543211', '1.1.1.2', 'store-a');
      await expect(
        service.requestCode('9876543212', '1.1.1.3', 'store-a'),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(sent).toHaveLength(2);
    });

    it('invalidates the challenge and reports failure when delivery fails', async () => {
      const { service, prisma } = build({ failSms: true });
      await expect(
        service.requestCode('9876543210', '1.1.1.1', 'store-a'),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(prisma.otpChallenge.rows[0].consumedAt).not.toBeNull();
    });
  });

  describe('verifyCode', () => {
    async function issued() {
      const ctx = build();
      await ctx.service.requestCode('9876543210', '1.1.1.1', 'store-a');
      return { ...ctx, code: ctx.sent[0].code };
    }

    it('accepts the right code and returns the E.164 number', async () => {
      const { service, code } = await issued();
      await expect(
        service.verifyCode('98765 43210', code, 'store-a'),
      ).resolves.toBe('+919876543210');
    });

    it('is single use', async () => {
      const { service, code } = await issued();
      await service.verifyCode('9876543210', code, 'store-a');
      await expect(
        service.verifyCode('9876543210', code, 'store-a'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects a wrong code', async () => {
      const { service, code } = await issued();
      const wrong = code === '000000' ? '000001' : '000000';
      await expect(
        service.verifyCode('9876543210', wrong, 'store-a'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('kills the challenge after the maximum attempts, even for the right code', async () => {
      const { service, code } = await issued();
      const wrong = code === '000000' ? '000001' : '000000';
      for (let i = 0; i < OTP_MAX_VERIFY_ATTEMPTS; i++) {
        await expect(
          service.verifyCode('9876543210', wrong, 'store-a'),
        ).rejects.toBeInstanceOf(UnauthorizedException);
      }
      await expect(
        service.verifyCode('9876543210', code, 'store-a'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects an expired code', async () => {
      const { service, prisma, code } = await issued();
      prisma.otpChallenge.rows[0].expiresAt = new Date(Date.now() - 1);
      await expect(
        service.verifyCode('9876543210', code, 'store-a'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects a code issued for a different number', async () => {
      const { service, code } = await issued();
      await expect(
        service.verifyCode('9876543211', code, 'store-a'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('uses the same generic error for every failure', async () => {
      const { service } = build();
      const err = await service
        .verifyCode('9876543210', '123456', 'store-a')
        .catch((e: HttpException) => e);
      expect((err as HttpException).message).toBe('Invalid or expired code');
    });
  });
});

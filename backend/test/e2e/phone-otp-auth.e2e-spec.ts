import { INestApplication } from '@nestjs/common';
import { resetDatabase } from './support/db';
import { apiPath, http } from './support/fixtures';

// The OTP flag/provider are read when the app boots, so set them before
// createTestApp(). The console provider is swapped for a spy below so tests
// can read the code that would have been SMSed.
process.env.AUTH_OTP_ENABLED = 'true';
process.env.OTP_SMS_PROVIDER = 'console';
process.env.OTP_HMAC_SECRET = 'e2e-otp-secret';

import { createTestApp } from './support/test-app';
import { ConsoleSmsProvider } from '../../src/auth/otp/sms/console-sms.provider';
import { PrismaService } from '../../src/common/database/prisma.service';

const PHONE = '9876543210';
const PHONE_E164 = '+919876543210';
const REFRESH_COOKIE_NAME = 'pf_refresh_token';

describe('Phone OTP login', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let lastCode: string | undefined;

  beforeAll(async () => {
    jest
      .spyOn(ConsoleSmsProvider.prototype, 'sendOtp')
      .mockImplementation((_phone: string, code: string) => {
        lastCode = code;
        return Promise.resolve();
      });
    ({ app, prisma } = await createTestApp());
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    lastCode = undefined;
  });

  async function requestCode(phone = PHONE): Promise<string> {
    lastCode = undefined;
    await http(app)
      .post(apiPath('/auth/otp/request'))
      .send({ phone })
      .expect(204);
    if (!lastCode) throw new Error('No SMS was sent');
    return lastCode;
  }

  function verify(code: string, phone = PHONE) {
    return http(app).post(apiPath('/auth/otp/verify')).send({ phone, code });
  }

  it('creates a phone-only customer on first verify and returns a working session', async () => {
    const code = await requestCode();
    const res = await verify(code).expect(200);

    expect(res.body.data?.accessToken ?? res.body.accessToken).toBeTruthy();
    const user = await prisma.user.findUnique({
      where: { phoneE164: PHONE_E164 },
    });
    expect(user).toMatchObject({
      role: 'CUSTOMER',
      email: null,
      passwordHash: null,
    });
    expect(user?.phoneVerifiedAt).not.toBeNull();

    const token = res.body.data?.accessToken ?? res.body.accessToken;
    await http(app)
      .get(apiPath('/users/me'))
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  });

  it('logs the same person into the same account on a later verify', async () => {
    await verify(await requestCode()).expect(200);
    // Move the first challenge out of the resend cooldown window.
    await prisma.otpChallenge.updateMany({
      data: { createdAt: new Date(Date.now() - 60_000) },
    });
    await verify(await requestCode()).expect(200);
    expect(await prisma.user.count({ where: { phoneE164: PHONE_E164 } })).toBe(
      1,
    );
  });

  it('issues a refresh cookie that rotates like a password session', async () => {
    const res = await verify(await requestCode()).expect(200);
    const cookie = (res.headers['set-cookie'] as unknown as string[]).find(
      (c) => c.startsWith(`${REFRESH_COOKIE_NAME}=`),
    );
    expect(cookie).toBeDefined();
    await http(app)
      .post(apiPath('/auth/refresh'))
      .set('Cookie', cookie!.split(';')[0])
      .expect(200);
  });

  it('rejects a wrong code and creates no account', async () => {
    const code = await requestCode();
    const wrong = code === '000000' ? '000001' : '000000';
    await verify(wrong).expect(401);
    expect(await prisma.user.count()).toBe(0);
  });

  it('rejects a reused code', async () => {
    const code = await requestCode();
    await verify(code).expect(200);
    await verify(code).expect(401);
  });

  it('rejects malformed input at the edge', async () => {
    await http(app)
      .post(apiPath('/auth/otp/request'))
      .send({ phone: '12345' })
      .expect(400);
    await http(app)
      .post(apiPath('/auth/otp/verify'))
      .send({ phone: PHONE, code: 'abcdef' })
      .expect(400);
  });

  it('never signs a staff account in by SMS', async () => {
    await prisma.user.create({
      data: {
        email: 'staff@example.test',
        passwordHash: 'x',
        role: 'ADMIN',
        phoneE164: PHONE_E164,
        phoneVerifiedAt: new Date(),
      },
    });
    await verify(await requestCode()).expect(401);
  });

  it('never signs a deactivated account in', async () => {
    await prisma.user.create({
      data: {
        phoneE164: PHONE_E164,
        phoneVerifiedAt: new Date(),
        isActive: false,
      },
    });
    await verify(await requestCode()).expect(401);
  });
});

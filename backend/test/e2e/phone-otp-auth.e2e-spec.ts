import { INestApplication } from '@nestjs/common';
import { resetDatabase } from './support/db';
import { apiPath, http, createProduct } from './support/fixtures';

// The OTP flag/provider are read when the app boots, so set them before
// createTestApp(). The console provider is swapped for a spy below so tests
// can read the code that would have been SMSed.
process.env.AUTH_OTP_ENABLED = 'true';
process.env.OTP_SMS_PROVIDER = 'console';
process.env.OTP_HMAC_SECRET = 'e2e-otp-secret';

import { createTestApp } from './support/test-app';
import { ConsoleSmsProvider } from '../../src/auth/otp/sms/console-sms.provider';
import { PrismaService } from '../../src/common/database/prisma.service';
import { seedStorefrontDomains } from '../../../prisma/storefront-domains';
import { withPlatformRlsBypass } from '../../src/common/tenant/tenant-rls';

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
    const store = await prisma.store.findFirstOrThrow();
    await withPlatformRlsBypass(prisma, tx => seedStorefrontDomains(tx, { storeId: store.id, tenantId: store.tenantId }, ['127.0.0.1', 'localhost']));
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
    const first = await verify(await requestCode()).expect(200);
    const store = await prisma.store.findFirstOrThrow();
    const product = await createProduct(prisma, { tenantId: store.tenantId });
    await http(app)
      .post(apiPath('/cart/items'))
      .set('Authorization', `Bearer ${first.body.data.accessToken}`)
      .send({ productId: product.productId, quantity: 2 })
      .expect(201);
    // Move the first challenge out of the resend cooldown window.
    await prisma.otpChallenge.updateMany({
      data: { createdAt: new Date(Date.now() - 60_000) },
    });
    const second = await verify(await requestCode()).expect(200);
    expect(await prisma.user.count({ where: { phoneE164: PHONE_E164 } })).toBe(
      1,
    );
    const cart = await http(app)
      .get(apiPath('/cart'))
      .set('Authorization', `Bearer ${second.body.data.accessToken}`)
      .expect(200);
    expect(cart.body.data.items).toHaveLength(1);
    expect(cart.body.data.items[0].quantity).toBe(2);
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
    await http(app)
      .post(apiPath('/auth/refresh'))
      .set('Cookie', cookie!.split(';')[0])
      .expect(401);
    await http(app)
      .get(apiPath('/users/me'))
      .set('Authorization', `Bearer ${res.body.data.accessToken}`)
      .expect(401);
  });

  it('only rotates one descendant from simultaneous refreshes', async () => {
    const res = await verify(await requestCode()).expect(200);
    const cookie = res.headers['set-cookie'][0].split(';')[0];
    const results = await Promise.all([
      http(app).post(apiPath('/auth/refresh')).set('Cookie', cookie),
      http(app).post(apiPath('/auth/refresh')).set('Cookie', cookie),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
    expect(await prisma.refreshToken.count()).toBe(2);
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

  it('only accepts one simultaneous verification and creates one identity', async () => {
    const code = await requestCode();
    const results = await Promise.all([
      verify(code),
      verify(code),
      verify(code),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 401, 401]);
    expect(await prisma.user.count()).toBe(1);
    expect(await prisma.refreshToken.count()).toBe(1);
  });

  it('reserves the cooldown atomically across simultaneous requests', async () => {
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        http(app).post(apiPath('/auth/otp/request')).send({ phone: PHONE }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([204, 429, 429, 429]);
    expect(await prisma.otpChallenge.count()).toBe(1);
  });

  it('expires codes and persists the wrong-guess attempt budget', async () => {
    const code = await requestCode();
    const wrong = code === '000000' ? '000001' : '000000';
    for (let i = 0; i < 5; i++) await verify(wrong).expect(401);
    await verify(code).expect(401);
    expect((await prisma.otpChallenge.findFirstOrThrow()).attempts).toBe(5);
    await prisma.otpChallenge.updateMany({
      data: { attempts: 0, expiresAt: new Date(Date.now() - 1) },
    });
    await verify(code).expect(401);
  });

  it('does not resurrect an older code after a resend is consumed', async () => {
    const oldCode = await requestCode();
    await prisma.otpChallenge.updateMany({
      data: { createdAt: new Date(Date.now() - 60_000) },
    });
    const newCode = await requestCode();
    await verify(newCode).expect(200);
    await verify(oldCode).expect(401);
    expect(
      await prisma.otpChallenge.count({ where: { consumedAt: null } }),
    ).toBe(0);
  });

  it('rejects unknown hosts instead of using the newest tenant', async () => {
    await http(app)
      .post(apiPath('/auth/otp/request'))
      .set('Host', 'unknown.test')
      .send({ phone: PHONE })
      .expect(401);
    expect(await prisma.otpChallenge.count()).toBe(0);
  });

  it('binds codes, access tokens and refresh to the issuing store', async () => {
    const tenant = await prisma.tenant.create({
      data: { slug: 'other-tenant' },
    });
    const store = await prisma.store.create({
      data: {
        tenantId: tenant.id,
        slug: 'other',
        name: 'Other',
        status: 'ACTIVE',
        isPrimary: true,
      },
    });
    await prisma.storeDomain.create({
      data: {
        storeId: store.id,
        tenantId: store.tenantId,
        hostname: 'other.test',
        verificationStatus: 'VERIFIED',
      },
    });
    const code = await requestCode();
    await http(app)
      .post(apiPath('/auth/otp/verify'))
      .set('Host', 'other.test')
      .send({ phone: PHONE, code })
      .expect(401);
    const session = await verify(code).expect(200);
    const token = session.body.data.accessToken;
    const cookie = session.headers['set-cookie'][0].split(';')[0];
    await http(app)
      .get(apiPath('/users/me'))
      .set('Host', 'other.test')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
    await http(app)
      .post(apiPath('/auth/refresh'))
      .set('Host', 'other.test')
      .set('Cookie', cookie)
      .expect(401);
    await http(app)
      .get(apiPath('/cart'))
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Tenant', tenant.id)
      .expect(403);
    // The original host still works, and context does not drift to the newest tenant.
    const cart = await http(app)
      .get(apiPath('/cart'))
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(cart.body.data).toBeTruthy();
    const user = await prisma.user.findUniqueOrThrow({
      where: { phoneE164: PHONE_E164 },
    });
    const actualCart = await prisma.cart.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(actualCart.tenantId).not.toBe(tenant.id);
  });

  it('rejects platform staff, tenant members and unbound legacy phone identities', async () => {
    const store = await prisma.store.findFirstOrThrow();
    const user = await prisma.user.create({
      data: {
        phoneE164: PHONE_E164,
        otpStoreId: store.id,
        platformRole: 'SUPER_ADMIN',
      },
    });
    let code = await requestCode();
    await verify(code).expect(401);
    await prisma.user.update({
      where: { id: user.id },
      data: { platformRole: null },
    });
    await prisma.tenantMembership.create({
      data: {
        tenantId: store.tenantId,
        userId: user.id,
        role: 'OWNER',
        status: 'ACTIVE',
      },
    });
    await prisma.otpChallenge.updateMany({
      data: { createdAt: new Date(Date.now() - 60_000) },
    });
    code = await requestCode();
    await verify(code).expect(401);
    await prisma.tenantMembership.deleteMany();
    await prisma.user.update({
      where: { id: user.id },
      data: { otpStoreId: null },
    });
    await prisma.otpChallenge.updateMany({
      data: { createdAt: new Date(Date.now() - 60_000) },
    });
    await verify(await requestCode()).expect(401);
  });
});

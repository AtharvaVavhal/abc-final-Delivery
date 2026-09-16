import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { resetDatabase } from './support/db';
import { createTestApp } from './support/test-app';
import {
  addCartItem,
  apiPath,
  authHeader,
  createCoupon,
  createProduct,
  http,
  makeTenantCheckoutReady,
  registerAdmin,
  registerUser,
  shippingFields,
} from './support/fixtures';
import { PrismaService } from '../../src/common/database/prisma.service';

/**
 * §27 #3, #13, #14 — three distinct order-creation race scenarios, each
 * exercising a different mechanism:
 *   #3/#13 — same Idempotency-Key, concurrent/double-clicked: the
 *     idempotency_keys unique-constraint claim (INSERT...ON CONFLICT) is
 *     what serializes these.
 *   #14 — different Idempotency-Keys, same cart, concurrent ("two tabs"):
 *     the idempotency claim does NOT dedupe this (different keys never
 *     conflict) — it's the `SELECT cart FOR UPDATE` row lock
 *     (checkout.service.ts) that must serialize it instead. This is the
 *     row-lock the blueprint's §13.G transaction boundary specifies as the
 *     *first* step; it was missing before this phase's fix (see the
 *     completion report) — this test is what caught it.
 *
 * Every "concurrent" case fires both requests via Promise.all against the
 * same running app/connection pool — genuinely concurrent, not sequential.
 */
describe('Checkout order-creation races (§27 #3, #13, #14)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  it('#3 — two genuinely concurrent POST /checkout/orders with the same Idempotency-Key produce exactly one order', async () => {
    const user = await registerUser(app);
    const { productId } = await createProduct(prisma, { basePrice: '75.00' });
    await addCartItem(app, user, { productId, quantity: 1 });

    const idempotencyKey = `same-key-concurrent-${randomUUID()}`;
    const fire = () =>
      http(app)
        .post(apiPath('/checkout/orders'))
        .set(...authHeader(user))
        .set('Idempotency-Key', idempotencyKey)
        .send(shippingFields());

    const [resA, resB] = await Promise.all([fire(), fire()]);

    expect([resA.status, resB.status].sort()).toEqual([200, 201]);

    const orders = await prisma.order.findMany({ where: { userId: user.id } });
    expect(orders).toHaveLength(1);
  });

  it('#13 — a double-clicked checkout (same Idempotency-Key sent twice) produces exactly one order and returns the same order both times', async () => {
    const user = await registerUser(app);
    const { productId } = await createProduct(prisma, { basePrice: '42.00' });
    await addCartItem(app, user, { productId, quantity: 3 });

    const idempotencyKey = `double-click-${randomUUID()}`;
    const fire = () =>
      http(app)
        .post(apiPath('/checkout/orders'))
        .set(...authHeader(user))
        .set('Idempotency-Key', idempotencyKey)
        .send(shippingFields());

    const [resA, resB] = await Promise.all([fire(), fire()]);

    const orders = await prisma.order.findMany({ where: { userId: user.id } });
    expect(orders).toHaveLength(1);

    // Same order id and same total in both responses — the replay returns
    // the original result, not a fresh computation.
    expect(resA.body.data.id).toBe(resB.body.data.id);
    expect(resA.body.data.orderNumber).toBe(resB.body.data.orderNumber);
    expect(resA.body.data.total).toBe(resB.body.data.total);
    expect(resA.body.data.total).toBe('126.00');
  });

  it('#14 — two simultaneous checkout tabs on the same cart, different Idempotency-Keys, produce exactly one order via the cart row lock', async () => {
    const user = await registerUser(app);
    const { productId } = await createProduct(prisma, { basePrice: '60.00' });
    await addCartItem(app, user, { productId, quantity: 2 });

    const fire = (key: string) =>
      http(app)
        .post(apiPath('/checkout/orders'))
        .set(...authHeader(user))
        .set('Idempotency-Key', key)
        .send(shippingFields());

    const [resA, resB] = await Promise.all([
      fire(`tab-a-${randomUUID()}`),
      fire(`tab-b-${randomUUID()}`),
    ]);

    // Different Idempotency-Keys mean the idempotency claim cannot be what
    // dedupes this — if it's still exactly one order, the cart row lock
    // plus resume-unpaid-order is what did it. Both requests succeed with
    // the same order; the cart stays populated until payment is captured.
    const statuses = [resA.status, resB.status].sort((a, b) => a - b)
    expect(statuses).toEqual([200, 201])

    const orders = await prisma.order.findMany({ where: { userId: user.id } })
    expect(orders).toHaveLength(1)
    expect(orders[0].total.toFixed(2)).toBe('120.00')

    expect(resA.body.data.id).toBe(orders[0].id)
    expect(resB.body.data.id).toBe(orders[0].id)

    const cartItems = await prisma.cartItem.findMany({
      where: { cart: { userId: user.id } },
    })
    expect(cartItems).toHaveLength(1)
  });

  it('#3 — a coupon with usageLimitTotal: 1, claimed by genuinely concurrent checkouts from different users, is granted to exactly one', async () => {
    const admin = await registerAdmin(app, prisma);
    await makeTenantCheckoutReady(prisma, admin.tenantId);
    const coupon = await createCoupon(prisma, admin.id, {
      percentageOff: 10,
      usageLimitTotal: 1,
    });
    const { productId } = await createProduct(prisma, { basePrice: '50.00' });

    const raceSize = 5;
    const users = await Promise.all(
      Array.from({ length: raceSize }, () => registerUser(app, 'racer')),
    );
    await Promise.all(
      users.map((user) => addCartItem(app, user, { productId, quantity: 1 })),
    );

    const fire = (user: (typeof users)[number]) =>
      http(app)
        .post(apiPath('/checkout/orders'))
        .set(...authHeader(user))
        .set('Idempotency-Key', `coupon-race-${user.id}`)
        .send({ ...shippingFields(), couponCode: coupon.code });

    const results = await Promise.all(users.map((user) => fire(user)));

    const succeeded = results.filter((r) => r.status === 201);
    const conflicted = results.filter((r) => r.status === 409);
    expect(succeeded).toHaveLength(1);
    expect(conflicted).toHaveLength(raceSize - 1);
    conflicted.forEach((r) => {
      expect(r.body.error.message).toMatch(/usage limit/i);
    });

    const persistedCoupon = await prisma.coupon.findUniqueOrThrow({
      where: { id: coupon.id },
    });
    expect(persistedCoupon.usedCount).toBe(1);

    const usages = await prisma.couponUsage.findMany({
      where: { couponId: coupon.id },
    });
    expect(usages).toHaveLength(1);
    expect(usages[0].orderId).toBe(succeeded[0].body.data.id);

    const orders = await prisma.order.findMany({
      where: { couponCode: coupon.code },
    });
    expect(orders).toHaveLength(1);

    // Every losing user's cart still has its item — the transaction rolled
    // back cleanly, nothing silently lost. The winner's cart also stays
    // until payment is captured (dismissing Razorpay must not empty it).
    for (const user of users) {
      const cartItems = await prisma.cartItem.findMany({
        where: { cart: { userId: user.id } },
      })
      expect(cartItems).toHaveLength(1)
    }
  });

  it('#14 — a second checkout while an unpaid order exists resumes that order instead of creating another', async () => {
    const user = await registerUser(app)
    const { productId } = await createProduct(prisma, { basePrice: '10.00' })
    await addCartItem(app, user, { productId, quantity: 1 })

    const first = await http(app)
      .post(apiPath('/checkout/orders'))
      .set(...authHeader(user))
      .set('Idempotency-Key', `sequential-first-${randomUUID()}`)
      .send(shippingFields())
      .expect(201)

    const second = await http(app)
      .post(apiPath('/checkout/orders'))
      .set(...authHeader(user))
      .set('Idempotency-Key', `sequential-second-${randomUUID()}`)
      .send(shippingFields())
      .expect(200)

    expect(second.body.data.id).toBe(first.body.data.id)

    const orders = await prisma.order.findMany({ where: { userId: user.id } })
    expect(orders).toHaveLength(1)

    const cartItems = await prisma.cartItem.findMany({
      where: { cart: { userId: user.id } },
    })
    expect(cartItems).toHaveLength(1)
  })

  it('cancels the unpaid order and creates a new one when the cart gains another product', async () => {
    const user = await registerUser(app)
    const { productId: firstProduct } = await createProduct(prisma, {
      basePrice: '10.00',
    })
    const { productId: secondProduct } = await createProduct(prisma, {
      basePrice: '15.00',
    })
    await addCartItem(app, user, { productId: firstProduct, quantity: 1 })

    const first = await http(app)
      .post(apiPath('/checkout/orders'))
      .set(...authHeader(user))
      .set('Idempotency-Key', `cart-changed-first-${randomUUID()}`)
      .send(shippingFields())
      .expect(201)

    await addCartItem(app, user, { productId: secondProduct, quantity: 1 })

    const second = await http(app)
      .post(apiPath('/checkout/orders'))
      .set(...authHeader(user))
      .set('Idempotency-Key', `cart-changed-second-${randomUUID()}`)
      .send(shippingFields())
      .expect(201)

    expect(second.body.data.id).not.toBe(first.body.data.id)
    expect(second.body.data.items).toHaveLength(2)

    const firstPersisted = await prisma.order.findUniqueOrThrow({
      where: { id: first.body.data.id },
    })
    expect(firstPersisted.status).toBe('CANCELLED')

    const allOrders = await prisma.order.findMany({ where: { userId: user.id } })
    expect(allOrders).toHaveLength(2)
  })

  it('applies a coupon onto an existing unpaid order so the payable total matches the discount', async () => {
    const admin = await registerAdmin(app, prisma)
    await makeTenantCheckoutReady(prisma, admin.tenantId)
    const coupon = await createCoupon(prisma, admin.id, {
      percentageOff: 10,
      usageLimitPerUser: 1,
    })
    const user = await registerUser(app)
    const { productId } = await createProduct(prisma, { basePrice: '100.00' })
    await addCartItem(app, user, { productId, quantity: 1 })

    const first = await http(app)
      .post(apiPath('/checkout/orders'))
      .set(...authHeader(user))
      .set('Idempotency-Key', `coupon-after-unpaid-${randomUUID()}`)
      .send(shippingFields())
      .expect(201)

    expect(first.body.data.couponCode).toBeNull()
    expect(first.body.data.discountAmount).toBe('0.00')

    await prisma.order.update({
      where: { id: first.body.data.id },
      data: { razorpayOrderId: 'order_pre_coupon' },
    })

    const second = await http(app)
      .post(apiPath('/checkout/orders'))
      .set(...authHeader(user))
      .set('Idempotency-Key', `coupon-after-unpaid-2-${randomUUID()}`)
      .send({ ...shippingFields(), couponCode: coupon.code })
      .expect(200)

    expect(second.body.data.id).toBe(first.body.data.id)
    expect(second.body.data.couponCode).toBe(coupon.code)
    expect(second.body.data.discountAmount).not.toBe('0.00')
    expect(Number(second.body.data.total)).toBeLessThan(Number(first.body.data.total))

    const persisted = await prisma.order.findUniqueOrThrow({
      where: { id: first.body.data.id },
    })
    expect(persisted.razorpayOrderId).toBeNull()
    expect(persisted.couponCode).toBe(coupon.code)

    const usages = await prisma.couponUsage.findMany({
      where: { orderId: first.body.data.id },
    })
    expect(usages).toHaveLength(1)

    const orders = await prisma.order.findMany({ where: { userId: user.id } })
    expect(orders).toHaveLength(1)
  })

  it('rejects swapping a coupon already claimed on an unpaid order', async () => {
    const admin = await registerAdmin(app, prisma)
    await makeTenantCheckoutReady(prisma, admin.tenantId)
    const firstCoupon = await createCoupon(prisma, admin.id, { percentageOff: 10 })
    const secondCoupon = await createCoupon(prisma, admin.id, { percentageOff: 20 })
    const user = await registerUser(app)
    const { productId } = await createProduct(prisma, { basePrice: '100.00' })
    await addCartItem(app, user, { productId, quantity: 1 })

    const created = await http(app)
      .post(apiPath('/checkout/orders'))
      .set(...authHeader(user))
      .set('Idempotency-Key', `coupon-swap-first-${randomUUID()}`)
      .send({ ...shippingFields(), couponCode: firstCoupon.code })
      .expect(201)

    expect(created.body.data.couponCode).toBe(firstCoupon.code)

    const swapped = await http(app)
      .post(apiPath('/checkout/orders'))
      .set(...authHeader(user))
      .set('Idempotency-Key', `coupon-swap-second-${randomUUID()}`)
      .send({ ...shippingFields(), couponCode: secondCoupon.code })
      .expect(409)

    expect(swapped.body.error.message).toMatch(/different coupon/i)
    expect(created.body.data.id).toBeDefined()

    const persisted = await prisma.order.findUniqueOrThrow({
      where: { id: created.body.data.id },
    })
    expect(persisted.couponCode).toBe(firstCoupon.code)
  })
});

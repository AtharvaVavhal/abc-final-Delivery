import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { resetDatabase } from './support/db';
import { createTestApp } from './support/test-app';
import {
  addCartItem,
  apiPath,
  authHeader,
  createProduct,
  http,
  makeTenantCheckoutReady,
  registerAdmin,
  registerUser,
} from './support/fixtures';
import { PrismaService } from '../../src/common/database/prisma.service';

/**
 * Phase 13.2 — Admin Control Plane.
 *
 * Covers: admin-only app-settings management (allowlist + validation +
 * shipping-fee consumed by checkout), category activation/deactivation,
 * product activation/deactivation, and the guarantee that internal
 * settings and inactive catalog rows stay hidden from the public surface.
 */
describe('Admin control plane (Phase 13.2)', () => {
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

  // ─── App settings ──────────────────────────────────────────────────────

  describe('GET/PATCH /admin/settings', () => {
    it('rejects a non-admin (403) and an anonymous caller (401)', async () => {
      const customer = await registerUser(app);

      await http(app).get(apiPath('/admin/settings')).expect(401);
      await http(app)
        .get(apiPath('/admin/settings'))
        .set(...authHeader(customer))
        .expect(403);
      await http(app)
        .patch(apiPath('/admin/settings/shippingFeeFlat'))
        .set(...authHeader(customer))
        .send({ value: '10.00' })
        .expect(403);
    });

    it('lists the configurable settings with current-or-default values', async () => {
      const admin = await registerAdmin(app, prisma);

      const res = await http(app)
        .get(apiPath('/admin/settings'))
        .set(...authHeader(admin))
        .expect(200);

      const keys = (res.body.data as Array<{ key: string }>).map((s) => s.key);
      expect(keys).toEqual(
        expect.arrayContaining(['shippingFeeFlat', 'announcement_text']),
      );
      expect(keys).not.toContain('order_number_counter');
      const shipping = (
        res.body.data as Array<{ key: string; value: string }>
      ).find((s) => s.key === 'shippingFeeFlat');
      expect(shipping?.value).toBe('0.00');
    });

    it('validates the shipping fee server-side', async () => {
      const admin = await registerAdmin(app, prisma);

      for (const bad of ['-1', 'free', '9.999', '100000.01', '']) {
        await http(app)
          .patch(apiPath('/admin/settings/shippingFeeFlat'))
          .set(...authHeader(admin))
          .send({ value: bad })
          .expect(400);
      }

      const ok = await http(app)
        .patch(apiPath('/admin/settings/shippingFeeFlat'))
        .set(...authHeader(admin))
        .send({ value: '49' })
        .expect(200);
      expect(ok.body.data.value).toBe('49.00');
    });

    it('rejects an unknown / internal setting key (400), never writing it', async () => {
      const admin = await registerAdmin(app, prisma);

      await http(app)
        .patch(apiPath('/admin/settings/order_number_counter'))
        .set(...authHeader(admin))
        .send({ value: '0' })
        .expect(400);

      const row = await prisma.appSetting.findUnique({
        where: { key: 'order_number_counter' },
      });
      // Only ever written by OrdersService.generateOrderNumber, never here.
      expect(row).toBeNull();
    });

    it('a configured shipping fee is used by the checkout total (server-authoritative)', async () => {
      const admin = await registerAdmin(app, prisma);
      await makeTenantCheckoutReady(prisma, admin.tenantId);
      await http(app)
        .patch(apiPath('/admin/settings/shippingFeeFlat'))
        .set(...authHeader(admin))
        .send({ value: '49.00' })
        .expect(200);

      const customer = await registerUser(app);
      const { productId } = await createProduct(prisma, {
        basePrice: '100.00',
      });
      await addCartItem(app, customer, { productId, quantity: 1 });

      const res = await http(app)
        .post(apiPath('/checkout/orders'))
        .set(...authHeader(customer))
        .set('Idempotency-Key', `ship-${customer.id}`)
        .send({
          shippingRecipientName: 'Test Recipient',
          shippingPhone: '9999999999',
          shippingAddressLine1: '123 Test Street',
          shippingCity: 'Pune',
          shippingState: 'Maharashtra',
          shippingPostalCode: '411001',
          shippingCountry: 'India',
        })
        .expect(201);

      expect(res.body.data.subtotal).toBe('100.00');
      expect(res.body.data.shippingFee).toBe('49.00');
      expect(res.body.data.total).toBe('149.00');
    });
  });

  // ─── Store identity (Store Name / Store Admin Name) ────────────────────

  describe('store identity settings', () => {
    it('rejects a non-admin update of storeName / storeAdminName (403, 401)', async () => {
      const customer = await registerUser(app);

      await http(app)
        .patch(apiPath('/admin/settings/storeName'))
        .send({ value: 'Rogue Store' })
        .expect(401);
      await http(app)
        .patch(apiPath('/admin/settings/storeName'))
        .set(...authHeader(customer))
        .send({ value: 'Rogue Store' })
        .expect(403);
      await http(app)
        .patch(apiPath('/admin/settings/storeAdminName'))
        .set(...authHeader(customer))
        .send({ value: 'Rogue Owner' })
        .expect(403);

      // Phase 5 W9 (decision D11) — storeName is STORE-owned; a rejected
      // write must leave no row in storeSettings, never the old global
      // app_settings table.
      expect(
        await prisma.storeSetting.findFirst({ where: { key: 'storeName' } }),
      ).toBeNull();
    });

    it('lists storeName defaulting to "AB Creations" and admin can update both values (persisted)', async () => {
      const admin = await registerAdmin(app, prisma);

      const list = await http(app)
        .get(apiPath('/admin/settings'))
        .set(...authHeader(admin))
        .expect(200);
      const storeName = (
        list.body.data as Array<{ key: string; value: string }>
      ).find((s) => s.key === 'storeName');
      expect(storeName?.value).toBe('AB Creations');

      await http(app)
        .patch(apiPath('/admin/settings/storeName'))
        .set(...authHeader(admin))
        .send({ value: '  Atharva Prints  ' })
        .expect(200)
        .expect((r) => expect(r.body.data.value).toBe('Atharva Prints'));

      await http(app)
        .patch(apiPath('/admin/settings/storeAdminName'))
        .set(...authHeader(admin))
        .send({ value: 'Atharva Vavhal' })
        .expect(200);

      // Survives a fresh read (new request, no in-memory state).
      const reread = await http(app)
        .get(apiPath('/admin/settings'))
        .set(...authHeader(admin))
        .expect(200);
      const byKey = Object.fromEntries(
        (reread.body.data as Array<{ key: string; value: string }>).map((s) => [
          s.key,
          s.value,
        ]),
      );
      expect(byKey.storeName).toBe('Atharva Prints');
      expect(byKey.storeAdminName).toBe('Atharva Vavhal');
    });

    it('rejects an empty storeName server-side (required)', async () => {
      const admin = await registerAdmin(app, prisma);
      await http(app)
        .patch(apiPath('/admin/settings/storeName'))
        .set(...authHeader(admin))
        .send({ value: '   ' })
        .expect(400);
    });

    it('public GET /settings/storeName returns "AB Creations" by default, then the saved value', async () => {
      // Default, before any admin has saved.
      const before = await http(app)
        .get(apiPath('/settings/storeName'))
        .expect(200);
      expect(before.body.data.value).toBe('AB Creations');

      const admin = await registerAdmin(app, prisma);
      await http(app)
        .patch(apiPath('/admin/settings/storeName'))
        .set(...authHeader(admin))
        .send({ value: 'Atharva Prints' })
        .expect(200);

      const after = await http(app)
        .get(apiPath('/settings/storeName'))
        .expect(200);
      expect(after.body.data.value).toBe('Atharva Prints');
    });

    it('never exposes storeAdminName through the public settings surface', async () => {
      const admin = await registerAdmin(app, prisma);
      await http(app)
        .patch(apiPath('/admin/settings/storeAdminName'))
        .set(...authHeader(admin))
        .send({ value: 'Atharva Vavhal' })
        .expect(200);

      // By exact key → null (not on the public allowlist).
      const byKey = await http(app)
        .get(apiPath('/settings/storeAdminName'))
        .expect(200);
      expect(byKey.body.data.value).toBeNull();

      // In a bulk query → dropped from the map.
      const byQuery = await http(app)
        .get(apiPath('/settings'))
        .query({ keys: 'storeName,storeAdminName' })
        .expect(200);
      expect(byQuery.body.data.data).not.toHaveProperty('storeAdminName');
    });
  });

  // ─── Public settings surface ───────────────────────────────────────────

  describe('GET /settings (public) — allowlist', () => {
    it('does not expose the internal order-number counter by exact key', async () => {
      // Force the counter row to exist by creating an order.
      const customer = await registerUser(app);
      const { productId } = await createProduct(prisma);
      await addCartItem(app, customer, { productId, quantity: 1 });
      await http(app)
        .post(apiPath('/checkout/orders'))
        .set(...authHeader(customer))
        .set('Idempotency-Key', `counter-${customer.id}`)
        .send({
          shippingRecipientName: 'R',
          shippingPhone: '9999999999',
          shippingAddressLine1: '1 St',
          shippingCity: 'Pune',
          shippingState: 'MH',
          shippingPostalCode: '411001',
          shippingCountry: 'India',
        })
        .expect(201);

      const counterRow = await prisma.appSetting.findUnique({
        where: { key: 'order_number_counter' },
      });
      expect(counterRow).not.toBeNull();

      const byKey = await http(app)
        .get(apiPath('/settings/order_number_counter'))
        .expect(200);
      expect(byKey.body.data.value).toBeNull();

      // GET /settings returns `{ data: <map> }` under the envelope's own
      // `data` (unchanged pre-existing shape — no `meta`, so the
      // ResponseInterceptor doesn't lift it). Non-public keys are dropped
      // before the query, so the map is empty.
      const byQuery = await http(app)
        .get(apiPath('/settings'))
        .query({ keys: 'order_number_counter,shippingFeeFlat' })
        .expect(200);
      expect(byQuery.body.data.data).toEqual({});
    });

    it('still serves the announcement text set through the admin API', async () => {
      const admin = await registerAdmin(app, prisma);
      await http(app)
        .patch(apiPath('/admin/settings/announcement_text'))
        .set(...authHeader(admin))
        .send({ value: 'Launch week — free shipping' })
        .expect(200);

      const res = await http(app)
        .get(apiPath('/settings/announcement_text'))
        .expect(200);
      expect(res.body.data.value).toBe('Launch week — free shipping');
    });
  });

  // ─── Categories ────────────────────────────────────────────────────────

  describe('category activation', () => {
    async function makeCategory(
      name: string,
      isActive = true,
      tenantId?: string,
    ) {
      const resolvedTenantId =
        tenantId ??
        (await prisma.tenant.create({ data: { slug: `t-${randomUUID()}` } }))
          .id;
      return prisma.category.create({
        data: {
          name,
          slug: `${name.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          isActive,
          tenantId: resolvedTenantId,
        },
      });
    }

    it('admin listing includes inactive categories; public listing/tree does not', async () => {
      const admin = await registerAdmin(app, prisma);
      const active = await makeCategory('Mugs', true, admin.tenantId);
      const inactive = await makeCategory('Retired', false, admin.tenantId);

      const adminRes = await http(app)
        .get(apiPath('/categories/admin'))
        .set(...authHeader(admin))
        .expect(200);
      const adminIds = (adminRes.body.data as Array<{ id: string }>).map(
        (c) => c.id,
      );
      expect(adminIds).toEqual(
        expect.arrayContaining([active.id, inactive.id]),
      );

      const publicRes = await http(app).get(apiPath('/categories')).expect(200);
      const publicIds = (publicRes.body.data as Array<{ id: string }>).map(
        (c) => c.id,
      );
      expect(publicIds).toContain(active.id);
      expect(publicIds).not.toContain(inactive.id);

      const treeRes = await http(app)
        .get(apiPath('/categories/tree'))
        .expect(200);
      const treeIds = (treeRes.body.data as Array<{ id: string }>).map(
        (c) => c.id,
      );
      expect(treeIds).not.toContain(inactive.id);
    });

    it('non-admin cannot deactivate or reactivate a category', async () => {
      const customer = await registerUser(app);
      const cat = await makeCategory('Mugs');

      await http(app)
        .delete(apiPath(`/categories/${cat.id}`))
        .set(...authHeader(customer))
        .expect(403);
      await http(app)
        .post(apiPath(`/categories/${cat.id}/reactivate`))
        .set(...authHeader(customer))
        .expect(403);

      const row = await prisma.category.findUnique({ where: { id: cat.id } });
      expect(row?.isActive).toBe(true);
    });

    it('admin can deactivate then reactivate a category', async () => {
      const admin = await registerAdmin(app, prisma);
      const cat = await makeCategory('Seasonal', true, admin.tenantId);

      await http(app)
        .delete(apiPath(`/categories/${cat.id}`))
        .set(...authHeader(admin))
        .expect(200);
      expect(
        (await prisma.category.findUnique({ where: { id: cat.id } }))?.isActive,
      ).toBe(false);

      // Hidden from public immediately.
      const hidden = await http(app).get(apiPath('/categories')).expect(200);
      expect(
        (hidden.body.data as Array<{ id: string }>).map((c) => c.id),
      ).not.toContain(cat.id);

      await http(app)
        .post(apiPath(`/categories/${cat.id}/reactivate`))
        .set(...authHeader(admin))
        .expect(200);
      expect(
        (await prisma.category.findUnique({ where: { id: cat.id } }))?.isActive,
      ).toBe(true);
    });
  });

  // ─── Products ──────────────────────────────────────────────────────────

  describe('product activation', () => {
    it('admin listing includes inactive products; public catalog does not', async () => {
      const admin = await registerAdmin(app, prisma);
      const activeProd = await createProduct(prisma, { name: 'Active Mug' });
      const inactiveProd = await createProduct(prisma, {
        name: 'Retired Mug',
        isActive: false,
      });

      const adminRes = await http(app)
        .get(apiPath('/products/admin'))
        .set(...authHeader(admin))
        .expect(200);
      const adminIds = (adminRes.body.data as Array<{ id: string }>).map(
        (p) => p.id,
      );
      expect(adminIds).toEqual(
        expect.arrayContaining([activeProd.productId, inactiveProd.productId]),
      );

      const inactiveOnly = await http(app)
        .get(apiPath('/products/admin'))
        .query({ status: 'inactive' })
        .set(...authHeader(admin))
        .expect(200);
      const inactiveIds = (inactiveOnly.body.data as Array<{ id: string }>).map(
        (p) => p.id,
      );
      expect(inactiveIds).toEqual([inactiveProd.productId]);

      const publicRes = await http(app).get(apiPath('/products')).expect(200);
      const publicIds = (publicRes.body.data as Array<{ id: string }>).map(
        (p) => p.id,
      );
      expect(publicIds).toContain(activeProd.productId);
      expect(publicIds).not.toContain(inactiveProd.productId);
    });

    it('admin can fetch a deactivated product by id (public slug lookup 404s)', async () => {
      const admin = await registerAdmin(app, prisma);
      const { productId, slug } = await createProduct(prisma, {
        isActive: false,
      });

      await http(app)
        .get(apiPath(`/products/admin/${productId}`))
        .set(...authHeader(admin))
        .expect(200);

      await http(app)
        .get(apiPath(`/products/${slug}`))
        .expect(404);
    });

    it('non-admin cannot deactivate or reactivate a product', async () => {
      const customer = await registerUser(app);
      const { productId } = await createProduct(prisma);

      await http(app)
        .delete(apiPath(`/products/${productId}`))
        .set(...authHeader(customer))
        .expect(403);
      await http(app)
        .post(apiPath(`/products/${productId}/reactivate`))
        .set(...authHeader(customer))
        .expect(403);

      expect(
        (await prisma.product.findUnique({ where: { id: productId } }))
          ?.isActive,
      ).toBe(true);
    });

    it('admin can deactivate then reactivate a product', async () => {
      const admin = await registerAdmin(app, prisma);
      const { productId } = await createProduct(prisma);

      await http(app)
        .delete(apiPath(`/products/${productId}`))
        .set(...authHeader(admin))
        .expect(200);
      expect(
        (await prisma.product.findUnique({ where: { id: productId } }))
          ?.isActive,
      ).toBe(false);

      await http(app)
        .post(apiPath(`/products/${productId}/reactivate`))
        .set(...authHeader(admin))
        .expect(200);
      expect(
        (await prisma.product.findUnique({ where: { id: productId } }))
          ?.isActive,
      ).toBe(true);
    });
  });
});

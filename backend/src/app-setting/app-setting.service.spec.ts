import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { TenantContext } from '../common/tenant/tenant-context';
import { AppSettingService } from './app-setting.service';

/**
 * Focused on the Phase 13.2 additions — listConfigurable / updateConfigurable
 * and the per-key server-side validation in app-setting.constants.ts. Same
 * direct-instantiation mocking pattern as products.service.spec.ts. The
 * public read paths (get / getMany) are exercised end-to-end in
 * test/e2e/admin-control-plane.e2e-spec.ts.
 *
 * Phase 5 W8: `updateConfigurable` runs inside `prisma.$transaction` (so its
 * TenantAuditLog write commits atomically with it).
 *
 * Phase 5 W9 (decision D11): every key now routes to `TenantSetting` or
 * `StoreSetting` based on its frozen ownership — `buildService` mocks both
 * delegates (plus a `store` delegate behind `$extends`, standing in for
 * `resolvePrimaryStoreId`'s D4 tenant-scoped client) so tests can assert
 * each key lands in the correct table without hitting a real database.
 */
const tenantContext: TenantContext = {
  tenantId: 'tenant-a',
  source: 'membership-default',
  membership: { role: 'OWNER' },
};

const actor: AuthenticatedUser = {
  id: 'owner-1',
  email: 'owner@example.test',
  role: 'ADMIN',
  platformRole: null,
  memberships: [{ tenantId: 'tenant-a', role: 'OWNER' }],
};

const PRIMARY_STORE_ID = 'store-a';

describe('AppSettingService — configurable settings', () => {
  function buildService(
    opts: {
      tenantValues?: Record<string, string>;
      storeValues?: Record<string, string>;
      /** Pass `null` to simulate a tenant with no primary store configured. */
      primaryStore?: { id: string } | null;
    } = {},
  ) {
    const tenantValues = opts.tenantValues ?? {};
    const storeValues = opts.storeValues ?? {};
    const primaryStore =
      opts.primaryStore === undefined
        ? { id: PRIMARY_STORE_ID }
        : opts.primaryStore;

    const tenantSettingDelegate = {
      findUnique: jest
        .fn()
        .mockImplementation(
          ({
            where,
          }: {
            where: { tenantId_key: { tenantId: string; key: string } };
          }) => {
            const { key } = where.tenantId_key;
            return Promise.resolve(
              tenantValues[key] !== undefined
                ? { value: tenantValues[key] }
                : null,
            );
          },
        ),
      findMany: jest
        .fn()
        .mockImplementation(
          ({ where }: { where: { tenantId: string; key: { in: string[] } } }) =>
            Promise.resolve(
              where.key.in
                .filter((k) => tenantValues[k] !== undefined)
                .map((k) => ({ key: k, value: tenantValues[k] })),
            ),
        ),
      upsert: jest.fn().mockResolvedValue(undefined),
    };
    const storeSettingDelegate = {
      findUnique: jest
        .fn()
        .mockImplementation(
          ({
            where,
          }: {
            where: { storeId_key: { storeId: string; key: string } };
          }) => {
            const { key } = where.storeId_key;
            return Promise.resolve(
              storeValues[key] !== undefined
                ? { value: storeValues[key] }
                : null,
            );
          },
        ),
      findMany: jest
        .fn()
        .mockImplementation(
          ({ where }: { where: { storeId: string; key: { in: string[] } } }) =>
            Promise.resolve(
              where.key.in
                .filter((k) => storeValues[k] !== undefined)
                .map((k) => ({ key: k, value: storeValues[k] })),
            ),
        ),
      upsert: jest.fn().mockResolvedValue(undefined),
    };
    const tenantMembershipDelegate = {
      findUnique: jest.fn().mockResolvedValue({ id: 'membership-1' }),
    };
    // Stands in for `resolvePrimaryStoreId`'s D4 tenant-scoped client
    // (`getTenantScopedClient` calls `prisma.$extends(...)`) — the
    // scoping middleware itself is exercised by tenant-prisma.spec.ts, so
    // this mock simply returns the configured primary store, ignoring the
    // `$extends` config object (this unit is not testing the scoping
    // mechanism, only that AppSettingService uses its result correctly).
    const storeDelegate = {
      findFirst: jest.fn().mockResolvedValue(primaryStore),
    };
    const tx = {
      tenantSetting: tenantSettingDelegate,
      storeSetting: storeSettingDelegate,
      tenantMembership: tenantMembershipDelegate,
    };
    const prisma = {
      tenantSetting: tenantSettingDelegate,
      storeSetting: storeSettingDelegate,
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(tx)),
      $extends: jest.fn().mockReturnValue({ store: storeDelegate }),
    };
    const audit = { logTenantAction: jest.fn().mockResolvedValue(undefined) };
    const service = new AppSettingService(prisma as never, audit as never);
    return {
      service,
      tenantSettingDelegate,
      storeSettingDelegate,
      storeDelegate,
      audit,
    };
  }

  describe('listConfigurable', () => {
    it('returns every defined setting, falling back to the default when no row exists', async () => {
      const { service } = buildService();
      const list = await service.listConfigurable(tenantContext);

      const shipping = list.find((s) => s.key === 'shippingFeeFlat');
      const announcement = list.find((s) => s.key === 'announcement_text');
      expect(shipping).toMatchObject({
        kind: 'money',
        value: '0.00',
        default: '0.00',
      });
      expect(announcement).toMatchObject({
        kind: 'text',
        value: '',
        default: '',
      });
    });

    it('reflects a stored STORE-owned value when a row exists', async () => {
      const { service } = buildService({
        storeValues: { shippingFeeFlat: '49.00' },
      });
      const list = await service.listConfigurable(tenantContext);
      expect(list.find((s) => s.key === 'shippingFeeFlat')?.value).toBe(
        '49.00',
      );
    });

    it('reflects a stored TENANT-owned value when a row exists', async () => {
      const { service } = buildService({
        tenantValues: { 'tax.ratePercent': '18.00' },
      });
      const list = await service.listConfigurable(tenantContext);
      expect(list.find((s) => s.key === 'tax.ratePercent')?.value).toBe(
        '18.00',
      );
    });

    it('never includes internal keys such as the order-number counter', async () => {
      const { service } = buildService();
      const list = await service.listConfigurable(tenantContext);
      expect(list.map((s) => s.key)).not.toContain('order_number_counter');
    });

    it('reads TENANT-owned settings via tenantSetting, filtered by the caller tenant', async () => {
      const { service, tenantSettingDelegate } = buildService();
      await service.listConfigurable(tenantContext);
      const [call] = tenantSettingDelegate.findMany.mock.calls[0] as [
        { where: { tenantId: string } },
      ];
      expect(call.where.tenantId).toBe('tenant-a');
    });

    it('resolves the primary store for STORE-owned settings, never a client-supplied storeId', async () => {
      const { service, storeDelegate } = buildService();
      await service.listConfigurable(tenantContext);
      expect(storeDelegate.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { isPrimary: true } }),
      );
    });
  });

  describe('updateConfigurable — shipping fee (STORE-owned)', () => {
    it('accepts a valid non-negative amount, stores a canonical 2dp string in storeSetting', async () => {
      const { service, storeSettingDelegate, tenantSettingDelegate } =
        buildService();
      const view = await service.updateConfigurable(
        tenantContext,
        actor,
        'shippingFeeFlat',
        '49',
      );
      expect(view.value).toBe('49.00');
      expect(storeSettingDelegate.upsert).toHaveBeenCalledWith({
        where: {
          storeId_key: { storeId: PRIMARY_STORE_ID, key: 'shippingFeeFlat' },
        },
        update: { value: '49.00' },
        create: {
          tenantId: 'tenant-a',
          storeId: PRIMARY_STORE_ID,
          key: 'shippingFeeFlat',
          value: '49.00',
        },
      });
      expect(tenantSettingDelegate.upsert).not.toHaveBeenCalled();
    });

    it('accepts 0 (free shipping)', async () => {
      const { service } = buildService();
      const view = await service.updateConfigurable(
        tenantContext,
        actor,
        'shippingFeeFlat',
        '0',
      );
      expect(view.value).toBe('0.00');
    });

    it('rejects a negative amount', async () => {
      const { service, storeSettingDelegate } = buildService();
      await expect(
        service.updateConfigurable(
          tenantContext,
          actor,
          'shippingFeeFlat',
          '-5',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(storeSettingDelegate.upsert).not.toHaveBeenCalled();
    });

    it('rejects a non-numeric amount', async () => {
      const { service } = buildService();
      await expect(
        service.updateConfigurable(
          tenantContext,
          actor,
          'shippingFeeFlat',
          'free',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects more than 2 decimal places', async () => {
      const { service } = buildService();
      await expect(
        service.updateConfigurable(
          tenantContext,
          actor,
          'shippingFeeFlat',
          '9.999',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects an absurdly large amount', async () => {
      const { service } = buildService();
      await expect(
        service.updateConfigurable(
          tenantContext,
          actor,
          'shippingFeeFlat',
          '100000.01',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('fails closed (never falls back to a global default) when the tenant has no primary store', async () => {
      const { service, storeSettingDelegate } = buildService({
        primaryStore: null,
      });
      await expect(
        service.updateConfigurable(
          tenantContext,
          actor,
          'shippingFeeFlat',
          '49',
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(storeSettingDelegate.upsert).not.toHaveBeenCalled();
    });
  });

  describe('updateConfigurable — announcement text (STORE-owned)', () => {
    it('trims and stores the text', async () => {
      const { service, storeSettingDelegate } = buildService();
      const view = await service.updateConfigurable(
        tenantContext,
        actor,
        'announcement_text',
        '  Free shipping this week  ',
      );
      expect(view.value).toBe('Free shipping this week');
      expect(storeSettingDelegate.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: { value: 'Free shipping this week' },
        }),
      );
    });

    it('allows an empty string (hides the bar)', async () => {
      const { service } = buildService();
      const view = await service.updateConfigurable(
        tenantContext,
        actor,
        'announcement_text',
        '   ',
      );
      expect(view.value).toBe('');
    });

    it('rejects text over the length limit', async () => {
      const { service } = buildService();
      await expect(
        service.updateConfigurable(
          tenantContext,
          actor,
          'announcement_text',
          'x'.repeat(201),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('updateConfigurable — tax settings (TENANT-owned)', () => {
    it('accepts tax.enabled true/false, normalizes case, and writes tenantSetting (never storeSetting)', async () => {
      const { service, tenantSettingDelegate, storeSettingDelegate } =
        buildService();
      expect(
        (
          await service.updateConfigurable(
            tenantContext,
            actor,
            'tax.enabled',
            'TRUE',
          )
        ).value,
      ).toBe('true');
      expect(
        (
          await service.updateConfigurable(
            tenantContext,
            actor,
            'tax.enabled',
            'false',
          )
        ).value,
      ).toBe('false');
      expect(tenantSettingDelegate.upsert).toHaveBeenCalledWith({
        where: { tenantId_key: { tenantId: 'tenant-a', key: 'tax.enabled' } },
        update: { value: 'false' },
        create: { tenantId: 'tenant-a', key: 'tax.enabled', value: 'false' },
      });
      expect(storeSettingDelegate.upsert).not.toHaveBeenCalled();
    });

    it('rejects a non-boolean tax.enabled', async () => {
      const { service } = buildService();
      await expect(
        service.updateConfigurable(tenantContext, actor, 'tax.enabled', 'yes'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('accepts INCLUSIVE and rejects an unknown pricing mode', async () => {
      const { service } = buildService();
      expect(
        (
          await service.updateConfigurable(
            tenantContext,
            actor,
            'tax.pricingMode',
            'INCLUSIVE',
          )
        ).value,
      ).toBe('INCLUSIVE');
      await expect(
        service.updateConfigurable(
          tenantContext,
          actor,
          'tax.pricingMode',
          'HYBRID',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('LOCKS tax-EXCLUSIVE pricing — it cannot be set via the admin path (Phase 13.4 hardening)', async () => {
      const { service, tenantSettingDelegate } = buildService();
      await expect(
        service.updateConfigurable(
          tenantContext,
          actor,
          'tax.pricingMode',
          'EXCLUSIVE',
        ),
      ).rejects.toThrow(/business confirmation/i);
      expect(tenantSettingDelegate.upsert).not.toHaveBeenCalled();
    });

    it('only offers INCLUSIVE as a selectable pricing mode', async () => {
      const { service } = buildService();
      const list = await service.listConfigurable(tenantContext);
      const mode = list.find((s) => s.key === 'tax.pricingMode');
      expect(mode?.options).toEqual(['INCLUSIVE']);
    });

    it('accepts a GST rate in 0..100 with 2dp, rejects out-of-range / junk', async () => {
      const { service } = buildService();
      expect(
        (
          await service.updateConfigurable(
            tenantContext,
            actor,
            'tax.ratePercent',
            '18',
          )
        ).value,
      ).toBe('18.00');
      for (const bad of ['-1', '150', 'eighteen', '5.005']) {
        await expect(
          service.updateConfigurable(
            tenantContext,
            actor,
            'tax.ratePercent',
            bad,
          ),
        ).rejects.toBeInstanceOf(BadRequestException);
      }
    });

    it('surfaces the pending-client-input flag on the tax rate', async () => {
      const { service } = buildService();
      const list = await service.listConfigurable(tenantContext);
      const rate = list.find((s) => s.key === 'tax.ratePercent');
      expect(rate?.pendingClientInput).toBe(true);
      expect(rate?.value).toBe('0.00');
    });

    it('never resolves a primary store for a TENANT-owned-only update (no store lookup at all)', async () => {
      const { service, storeDelegate } = buildService();
      await service.updateConfigurable(
        tenantContext,
        actor,
        'tax.enabled',
        'true',
      );
      expect(storeDelegate.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('updateConfigurable — invoice settings (TENANT-owned)', () => {
    it('validates the invoice prefix', async () => {
      const { service } = buildService();
      expect(
        (
          await service.updateConfigurable(
            tenantContext,
            actor,
            'invoice.numberPrefix',
            'inv/',
          )
        ).value,
      ).toBe('INV/');
      await expect(
        service.updateConfigurable(
          tenantContext,
          actor,
          'invoice.numberPrefix',
          'has spaces',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('accepts a blank GSTIN (pending) but rejects a malformed one', async () => {
      const { service } = buildService();
      expect(
        (
          await service.updateConfigurable(
            tenantContext,
            actor,
            'invoice.sellerGstin',
            '',
          )
        ).value,
      ).toBe('');
      expect(
        (
          await service.updateConfigurable(
            tenantContext,
            actor,
            'invoice.sellerGstin',
            '22aaaaa0000a1z5',
          )
        ).value,
      ).toBe('22AAAAA0000A1Z5');
      await expect(
        service.updateConfigurable(
          tenantContext,
          actor,
          'invoice.sellerGstin',
          'NOT-A-GSTIN',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('ships the seller identity fields blank and pending', async () => {
      const { service } = buildService();
      const list = await service.listConfigurable(tenantContext);
      const name = list.find((s) => s.key === 'invoice.sellerLegalName');
      expect(name?.value).toBe('');
      expect(name?.pendingClientInput).toBe(true);
    });
  });

  describe('updateConfigurable — unknown / internal keys', () => {
    it('rejects a key that is not in the definition list', async () => {
      const { service, tenantSettingDelegate, storeSettingDelegate } =
        buildService();
      await expect(
        service.updateConfigurable(
          tenantContext,
          actor,
          'order_number_counter',
          '0',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.updateConfigurable(tenantContext, actor, 'anything_else', 'x'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(tenantSettingDelegate.upsert).not.toHaveBeenCalled();
      expect(storeSettingDelegate.upsert).not.toHaveBeenCalled();
    });
  });

  describe('store identity — storeName / storeAdminName (STORE-owned)', () => {
    it('defaults storeName to "AB Creations" when no row exists', async () => {
      const { service } = buildService();
      const list = await service.listConfigurable(tenantContext);
      const storeName = list.find((s) => s.key === 'storeName');
      expect(storeName).toMatchObject({
        kind: 'text',
        value: 'AB Creations',
        default: 'AB Creations',
      });
    });

    it('defaults storeLogo to the bundled catalog mark when no row exists', async () => {
      const { service } = buildService();
      const list = await service.listConfigurable(tenantContext);
      const logo = list.find((s) => s.key === 'storeLogo');
      expect(logo).toMatchObject({
        kind: 'text',
        value: '/catalog/logo.png',
        default: '/catalog/logo.png',
      });
    });

    it('accepts a Cloudinary logo URL', async () => {
      const { service, storeSettingDelegate } = buildService();
      const view = await service.updateConfigurable(
        tenantContext,
        actor,
        'storeLogo',
        'https://res.cloudinary.com/demo/image/upload/logo.png',
      );
      expect(view.value).toBe(
        'https://res.cloudinary.com/demo/image/upload/logo.png',
      );
      expect(storeSettingDelegate.upsert).toHaveBeenCalled();
    });

    it('rejects a non-URL logo value', async () => {
      const { service, storeSettingDelegate } = buildService();
      await expect(
        service.updateConfigurable(tenantContext, actor, 'storeLogo', 'not a url'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(storeSettingDelegate.upsert).not.toHaveBeenCalled();
    });

    it('accepts a hero_slides JSON array', async () => {
      const { service, storeSettingDelegate } = buildService();
      const payload = JSON.stringify([
        {
          imageUrl: '/catalog/hero-3.jpg',
          headline: 'Acrylic caricatures',
          subtext: 'Made to order',
          ctaText: 'Shop',
          ctaLink: '/products',
        },
      ]);
      const view = await service.updateConfigurable(
        tenantContext,
        actor,
        'hero_slides',
        payload,
      );
      expect(JSON.parse(view.value)).toHaveLength(1);
      expect(storeSettingDelegate.upsert).toHaveBeenCalled();
    });

    it('defaults storeAdminName to an empty string (no name field to seed from)', async () => {
      const { service } = buildService();
      const list = await service.listConfigurable(tenantContext);
      const adminName = list.find((s) => s.key === 'storeAdminName');
      expect(adminName).toMatchObject({ value: '', default: '' });
    });

    it('reflects a stored store name over the default', async () => {
      const { service } = buildService({
        storeValues: { storeName: 'Atharva Prints' },
      });
      const list = await service.listConfigurable(tenantContext);
      expect(list.find((s) => s.key === 'storeName')?.value).toBe(
        'Atharva Prints',
      );
    });

    it('accepts and trims a new store name', async () => {
      const { service, storeSettingDelegate } = buildService();
      const view = await service.updateConfigurable(
        tenantContext,
        actor,
        'storeName',
        '  Atharva Prints  ',
      );
      expect(view.value).toBe('Atharva Prints');
      expect(storeSettingDelegate.upsert).toHaveBeenCalledWith({
        where: { storeId_key: { storeId: PRIMARY_STORE_ID, key: 'storeName' } },
        update: { value: 'Atharva Prints' },
        create: {
          tenantId: 'tenant-a',
          storeId: PRIMARY_STORE_ID,
          key: 'storeName',
          value: 'Atharva Prints',
        },
      });
    });

    it('rejects an empty / whitespace-only store name (required)', async () => {
      const { service, storeSettingDelegate } = buildService();
      await expect(
        service.updateConfigurable(tenantContext, actor, 'storeName', '   '),
      ).rejects.toThrow(/store name is required/i);
      expect(storeSettingDelegate.upsert).not.toHaveBeenCalled();
    });

    it('rejects a store name over 60 characters', async () => {
      const { service } = buildService();
      await expect(
        service.updateConfigurable(
          tenantContext,
          actor,
          'storeName',
          'x'.repeat(61),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('accepts and trims a store admin name', async () => {
      const { service } = buildService();
      const view = await service.updateConfigurable(
        tenantContext,
        actor,
        'storeAdminName',
        '  Atharva Vavhal  ',
      );
      expect(view.value).toBe('Atharva Vavhal');
    });

    it('allows an empty store admin name (optional)', async () => {
      const { service } = buildService();
      const view = await service.updateConfigurable(
        tenantContext,
        actor,
        'storeAdminName',
        '   ',
      );
      expect(view.value).toBe('');
    });

    it('rejects a store admin name over its length limit', async () => {
      const { service } = buildService();
      await expect(
        service.updateConfigurable(
          tenantContext,
          actor,
          'storeAdminName',
          'x'.repeat(121),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('audit wiring (W8, preserved/extended for W9 ownership)', () => {
    it('writes a setting.update TenantAuditLog row scoped to the caller tenant, recording key + ownership, never the raw value', async () => {
      const { service, audit } = buildService();
      await service.updateConfigurable(
        tenantContext,
        actor,
        'invoice.sellerGstin',
        '22AAAAA0000A1Z5',
      );
      expect(audit.logTenantAction).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          tenantId: 'tenant-a',
          action: 'setting.update',
          targetType: 'AppSetting',
          targetId: 'invoice.sellerGstin',
          metadata: {
            key: 'invoice.sellerGstin',
            ownership: 'TENANT',
            operation: 'update',
          },
        }),
      );
      const [, input] = audit.logTenantAction.mock.calls[0] as [
        unknown,
        { metadata: Record<string, unknown> },
      ];
      expect(JSON.stringify(input.metadata)).not.toContain('22AAAAA0000A1Z5');
    });

    it('tags a STORE-owned update with ownership: STORE in its audit metadata', async () => {
      const { service, audit } = buildService();
      await service.updateConfigurable(
        tenantContext,
        actor,
        'shippingFeeFlat',
        '49',
      );
      const [, input] = audit.logTenantAction.mock.calls[0] as [
        unknown,
        { metadata: Record<string, unknown> },
      ];
      expect(input.metadata).toMatchObject({ ownership: 'STORE' });
    });
  });
});

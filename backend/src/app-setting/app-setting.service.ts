import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../common/database/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { resolveTenantAuditActor } from '../common/audit/tenant-actor-attribution';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { resolvePrimaryStoreId } from '../common/tenant/primary-store';
import { TenantContext } from '../common/tenant/tenant-context';
import {
  ADMIN_SETTING_DEFINITIONS,
  AdminSettingKind,
  getAdminSettingDefinition,
  normalizeAdminSettingValue,
} from './app-setting.constants';

export interface AdminSettingView {
  key: string;
  label: string;
  description: string;
  kind: AdminSettingKind;
  value: string;
  default: string;
  options?: readonly string[];
  pendingClientInput?: boolean;
}

/**
 * Phase 5 W9 (decision D11) — tenant/store-owned configuration. The
 * original global `app_settings` table (still declared as the `AppSetting`
 * Prisma model, untouched) is no longer read or written for any of the 15
 * frozen D11 keys — every read/write below goes through `TenantSetting` /
 * `StoreSetting` instead. See the W9 implementation report for why the old
 * table could not be altered in place, and what still legitimately uses it
 * (`OrdersService.generateOrderNumber`'s platform-scoped order counter —
 * entirely unrelated to this service).
 *
 * Two families of method, matching the two trust boundaries a caller can
 * be on:
 *
 *   - `get(Many)TenantValue(s)` / `get(Many)StoreValueForTenant(s)` take a
 *     RAW, already-server-derived `tenantId` — the same convention
 *     `assertObjectInTenant`/`getTenantScopedClient`/
 *     `getSupportSessionScopedClient` already establish throughout this
 *     codebase: safety comes from the CALLER never passing a
 *     client-supplied value (an already-loaded Order's own `tenantId`, a
 *     Cart's own `tenantId`, `StorefrontTenantResolver`'s resolved
 *     tenantId), never from this service refusing a bare string type.
 *     These exist for other SERVICES (`TaxService`, `CheckoutService`,
 *     `InvoicesService`, the public storefront controller) that already
 *     hold a validated tenantId and need exactly one setting family.
 *
 *   - `listConfigurable` / `updateConfigurable` take a full
 *     `TenantContext` (+ actor) — the HTTP-controller-facing surface
 *     (`/admin/settings`), never a raw id from a request. Internally these
 *     route each key to `TenantSetting` or `StoreSetting` based on its
 *     frozen D11 `ownership` classification — a store-owned key can never
 *     be read/written as tenant-owned or vice versa, and there is no
 *     global fallback: a missing row returns the setting's own
 *     deterministic default, never another tenant's value.
 */
@Injectable()
export class AppSettingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  // ─── Internal accessors (server-derived tenantId; used by other services) ─

  async getTenantValue(tenantId: string, key: string): Promise<string | null> {
    const setting = await this.prisma.tenantSetting.findUnique({
      where: { tenantId_key: { tenantId, key } },
      select: { value: true },
    });
    return setting?.value ?? null;
  }

  async getManyTenantValues(
    tenantId: string,
    keys: readonly string[],
  ): Promise<Record<string, string>> {
    if (keys.length === 0) {
      return {};
    }
    const rows = await this.prisma.tenantSetting.findMany({
      where: { tenantId, key: { in: [...keys] } },
      select: { key: true, value: true },
    });
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }

  /** Resolves the tenant's primary Store internally — every current
   * caller of this method (checkout, tax) only ever has a tenantId on
   * hand, never a storeId (`Cart.storeId` is never populated by any code
   * path today). Fails closed (`resolvePrimaryStoreId` throws) rather
   * than silently falling back to a different store or a platform-wide
   * default. The public storefront controller uses `getStoreValue` /
   * `getManyStoreValues` with a storeId already resolved in the same
   * tenant-lookup transaction. */
  async getStoreValueForTenant(
    tenantId: string,
    key: string,
  ): Promise<string | null> {
    const storeId = await resolvePrimaryStoreId(this.prisma, tenantId);
    return this.getStoreValue(storeId, key);
  }

  async getStoreValue(storeId: string, key: string): Promise<string | null> {
    const setting = await this.prisma.storeSetting.findUnique({
      where: { storeId_key: { storeId, key } },
      select: { value: true },
    });
    return setting?.value ?? null;
  }

  async getManyStoreValuesForTenant(
    tenantId: string,
    keys: readonly string[],
  ): Promise<Record<string, string>> {
    if (keys.length === 0) {
      return {};
    }
    const storeId = await resolvePrimaryStoreId(this.prisma, tenantId);
    return this.getManyStoreValues(storeId, keys);
  }

  async getManyStoreValues(
    storeId: string,
    keys: readonly string[],
  ): Promise<Record<string, string>> {
    if (keys.length === 0) {
      return {};
    }
    const rows = await this.prisma.storeSetting.findMany({
      where: { storeId, key: { in: [...keys] } },
      select: { key: true, value: true },
    });
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }

  // ─── Admin-configurable settings (TenantContext-authenticated) ─────────

  /** Every administrable setting with its current value (or its default if
   * no row exists yet). Never returns internal keys — only the ones
   * declared in ADMIN_SETTING_DEFINITIONS. */
  async listConfigurable(
    tenantContext: TenantContext,
  ): Promise<AdminSettingView[]> {
    const tenantKeys = ADMIN_SETTING_DEFINITIONS.filter(
      (d) => d.ownership === 'TENANT',
    ).map((d) => d.key);
    const storeKeys = ADMIN_SETTING_DEFINITIONS.filter(
      (d) => d.ownership === 'STORE',
    ).map((d) => d.key);

    const [tenantValues, storeValues] = await Promise.all([
      this.getManyTenantValues(tenantContext.tenantId, tenantKeys),
      // Only resolve a primary store at all if a store-owned key actually
      // exists to read — a tenant with catalog-only administrable
      // settings should never fail listConfigurable over a missing store.
      storeKeys.length > 0
        ? this.getManyStoreValuesForTenant(tenantContext.tenantId, storeKeys)
        : Promise.resolve<Record<string, string>>({}),
    ]);
    const stored = { ...tenantValues, ...storeValues };

    return ADMIN_SETTING_DEFINITIONS.map((definition) => ({
      key: definition.key,
      label: definition.label,
      description: definition.description,
      kind: definition.kind,
      value: stored[definition.key] ?? definition.default,
      default: definition.default,
      options: definition.options,
      pendingClientInput: definition.pendingClientInput,
    }));
  }

  /**
   * Updates one administrable setting. Rejects any key not in the
   * allowlist and any value that fails that key's server-side validator,
   * so this endpoint can never write an arbitrary row or an invalid
   * money/text value. Routes the write to `TenantSetting` or
   * `StoreSetting` based on the key's frozen D11 ownership — never
   * client-selectable, never inferred per-row.
   */
  async updateConfigurable(
    tenantContext: TenantContext,
    actor: AuthenticatedUser,
    key: string,
    rawValue: string,
  ): Promise<AdminSettingView> {
    const definition = getAdminSettingDefinition(key);
    if (!definition) {
      throw new BadRequestException(`"${key}" is not an administrable setting`);
    }
    const result = normalizeAdminSettingValue(key, rawValue);
    if (!result.valid) {
      throw new BadRequestException(result.error);
    }

    // Resolved BEFORE the transaction: `resolvePrimaryStoreId` uses the D4
    // tenant-scoped client (`getTenantScopedClient`), which requires a
    // full `PrismaService` — not a `Prisma.TransactionClient` (Phase 5 W5's
    // own established limitation: an extended client cannot be built from
    // an already-open transaction). The write itself still commits
    // atomically with the audit row inside the transaction below.
    const storeId =
      definition.ownership === 'STORE'
        ? await resolvePrimaryStoreId(this.prisma, tenantContext.tenantId)
        : undefined;

    await this.prisma.$transaction(async (tx) => {
      if (definition.ownership === 'TENANT') {
        await tx.tenantSetting.upsert({
          where: {
            tenantId_key: { tenantId: tenantContext.tenantId, key },
          },
          update: { value: result.value },
          create: {
            tenantId: tenantContext.tenantId,
            key,
            value: result.value,
          },
        });
      } else {
        await tx.storeSetting.upsert({
          where: { storeId_key: { storeId: storeId as string, key } },
          update: { value: result.value },
          create: {
            tenantId: tenantContext.tenantId,
            storeId: storeId as string,
            key,
            value: result.value,
          },
        });
      }

      const attribution = await resolveTenantAuditActor(
        tx,
        tenantContext,
        actor,
      );
      // Phase 5 W9: metadata records key/ownership/operation only — never
      // the raw setting value (this session's own explicit instruction for
      // W9, tightening W8's original "previousValue/newValue" shape; some
      // of these 12 keys carry business-identifying data (e.g. a GSTIN)
      // that has no reason to be duplicated into an audit trail forever).
      await this.auditService.logTenantAction(tx, {
        tenantId: tenantContext.tenantId,
        ...attribution,
        action: 'setting.update',
        targetType: 'AppSetting',
        targetId: key,
        metadata: { key, ownership: definition.ownership, operation: 'update' },
      });
    });

    return {
      key: definition.key,
      label: definition.label,
      description: definition.description,
      kind: definition.kind,
      value: result.value,
      default: definition.default,
      options: definition.options,
      pendingClientInput: definition.pendingClientInput,
    };
  }
}

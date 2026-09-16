import {
  Controller,
  Get,
  Header,
  Param,
  Query,
  Req,
} from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { ThrottlePublicRead } from '../common/throttling/throttle.decorators';
import type { RequestWithTenantContext } from '../common/tenant/tenant-context';
import { StorefrontTenantResolver } from '../common/tenant/storefront-tenant.resolver';
import { AppSettingService } from './app-setting.service';
import {
  getAdminSettingDefinition,
  isPublicSettingKey,
} from './app-setting.constants';
import {
  PUBLIC_STOREFRONT_CACHE_CONTROL,
  PUBLIC_STOREFRONT_CACHE_VARY,
} from '../common/http/public-storefront-cache';

type RequestWithHostname = RequestWithTenantContext & { hostname: string };

/**
 * Public storefront read surface only. Admin management of the
 * configurable subset lives on AdminController (GET /admin/settings,
 * PATCH /admin/settings/:key) — never here.
 *
 * Both handlers filter to PUBLIC_SETTING_KEYS, so internal rows such as
 * the order-number counter (app-setting.constants.ts) are never exposed
 * even if requested by exact key.
 *
 * Phase 5 W9 (decision D11) — every current PUBLIC_SETTING_KEYS entry is
 * STORE-owned (confirmed by inspection: `storeName`, `announcement_text`,
 * `hero_slides`, `banners`, `showcase_categories`), so this controller only
 * ever needs to resolve a Store, never a TenantSetting read. Tenant
 * identity itself is NEVER taken from the request (query/header/body) —
 * resolved the same way `CartController`/`UploadsController` already
 * resolve it for other unauthenticated storefront routes: via
 * `StorefrontTenantResolver`, anchored to `request.tenantContext` /
 * `request.hostname`, never a client-supplied id.
 */
@ThrottlePublicRead()
@Controller('settings')
export class AppSettingController {
  constructor(
    private readonly appSettingService: AppSettingService,
    private readonly tenantResolver: StorefrontTenantResolver,
  ) {}

  private resolveStorefront(
    request: RequestWithHostname,
  ): Promise<{ tenantId: string; storeId: string }> {
    return this.tenantResolver.resolveActiveStorefront(
      request.tenantContext,
      request.hostname,
    );
  }

  @Public()
  @Header('Cache-Control', PUBLIC_STOREFRONT_CACHE_CONTROL)
  @Header('Vary', PUBLIC_STOREFRONT_CACHE_VARY)
  @Get(':key')
  async getOne(@Param('key') key: string, @Req() request: RequestWithHostname) {
    if (!isPublicSettingKey(key)) {
      return { value: null };
    }
    const { storeId } = await this.resolveStorefront(request);
    const stored = await this.appSettingService.getStoreValue(storeId, key);
    // When no row exists yet, fall back to the admin definition's default
    // (e.g. storeName → "AB Creations") so the public read is authoritative
    // for the default too, not just for a value an admin has saved.
    const value = stored ?? getAdminSettingDefinition(key)?.default ?? null;
    return { value };
  }

  @Public()
  @Header('Cache-Control', PUBLIC_STOREFRONT_CACHE_CONTROL)
  @Header('Vary', PUBLIC_STOREFRONT_CACHE_VARY)
  @Get()
  async getMany(
    @Query('keys') keys: string | undefined,
    @Req() request: RequestWithHostname,
  ) {
    const requested = keys
      ? keys
          .split(',')
          .map((k) => k.trim())
          .filter(Boolean)
      : [];
    const allowed = requested.filter(isPublicSettingKey);
    const { storeId } = await this.resolveStorefront(request);
    const values = await this.appSettingService.getManyStoreValues(
      storeId,
      allowed,
    );
    return { data: values };
  }
}

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { PlatformOnly } from '../common/decorators/platform-only.decorator';
import { ListPlatformAuditQueryDto } from './dto/list-platform-audit-query.dto';
import { ListPlatformTenantsQueryDto } from './dto/list-platform-tenants-query.dto';
import { SetMaintenanceDto } from './dto/set-maintenance.dto';
import { ResumeTenantDto } from './dto/resume-tenant.dto';
import { SuspendTenantDto } from './dto/suspend-tenant.dto';
import { PlatformService } from './platform.service';

/**
 * Owns (SaaS Master Plan §11; Phase 5 W3): GET /platform/tenants[/:id],
 * POST /platform/tenants/:id/suspend|resume, GET /platform/audit. Every
 * route here is `SUPER_ADMIN`-only via the class-level `@PlatformOnly()`
 * below — `PlatformGuard` (registered globally in `app.module.ts`) reads
 * this metadata (`Reflector.getAllAndOverride` checks the handler, then
 * falls back to the class), so a single class-level decorator covers every
 * method exactly as if it were repeated on each — there is no route here
 * that can silently fall through unguarded.
 *
 * `@PlatformOnly()` also makes `TenantContextGuard` skip this whole
 * controller (see that guard's own header comment) and `PermissionsGuard`
 * pass through (no `@RequirePermission` is ever declared here) — the
 * existing, pre-built platform-authorization path, unmodified. This
 * controller is the Platform Control Plane; the Tenant Control Plane
 * (`/admin/*`, `admin.controller.ts`) is untouched by this file.
 */
@Controller('platform')
@PlatformOnly()
export class PlatformController {
  constructor(private readonly platformService: PlatformService) {}

  @Get('tenants')
  async listTenants(@Query() query: ListPlatformTenantsQueryDto) {
    return this.platformService.listTenants(query);
  }

  @Get('tenants/:id')
  async tenantDetail(@Param('id', ParseUUIDPipe) id: string) {
    return this.platformService.getTenantDetail(id);
  }

  @Post('tenants/:id/suspend')
  @HttpCode(HttpStatus.OK)
  async suspendTenant(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SuspendTenantDto,
    @Ip() ip: string,
  ) {
    return this.platformService.suspendTenant(actor, id, dto.justification, ip);
  }

  @Post('tenants/:id/resume')
  @HttpCode(HttpStatus.OK)
  async resumeTenant(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResumeTenantDto,
    @Ip() ip: string,
  ) {
    return this.platformService.resumeTenant(actor, id, dto.justification, ip);
  }

  @Post('tenants/:id/maintenance')
  @HttpCode(HttpStatus.OK)
  async setMaintenance(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetMaintenanceDto,
    @Ip() ip: string,
  ) {
    return this.platformService.setMaintenance(
      actor,
      id,
      dto.enabled,
      dto.justification,
      ip,
    );
  }

  @Get('audit')
  async listPlatformAudit(@Query() query: ListPlatformAuditQueryDto) {
    return this.platformService.listPlatformAudit(query);
  }
}

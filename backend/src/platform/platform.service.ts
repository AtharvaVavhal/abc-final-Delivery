import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, TenantStatus } from '@prisma/client';
import { PrismaService } from '../common/database/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { PaginatedResult } from '../common/types/api-response.interface';
import { clearStorefrontRoutingCache } from '../common/tenant/storefront-routing-cache';
import { ListPlatformAuditQueryDto } from './dto/list-platform-audit-query.dto';
import { ListPlatformTenantsQueryDto } from './dto/list-platform-tenants-query.dto';
import { PlatformAuditLogEntryView } from './dto/platform-audit-view.interface';
import {
  PlatformTenantDetailView,
  PlatformTenantSummaryView,
} from './dto/platform-tenant-view.interface';

const TENANT_DETAIL_INCLUDE = {
  stores: {
    select: { id: true, slug: true, name: true, status: true, isPrimary: true },
  },
  subscription: { select: { status: true } },
} satisfies Prisma.TenantInclude;

type TenantDetailRow = Prisma.TenantGetPayload<{
  include: typeof TENANT_DETAIL_INCLUDE;
}>;

const TENANT_SUMMARY_INCLUDE = {
  _count: { select: { stores: true } },
} satisfies Prisma.TenantInclude;

type TenantSummaryRow = Prisma.TenantGetPayload<{
  include: typeof TENANT_SUMMARY_INCLUDE;
}>;

/**
 * Platform Control Plane service (SaaS Master Plan §11; Phase 5 W3).
 * `PlatformGuard`/`@PlatformOnly()` already restrict every route this
 * service backs to an authenticated `SUPER_ADMIN` before any method here
 * runs (`platform.controller.ts`) — this class does not re-check
 * `platformRole`; it receives the actor only to attribute audit rows.
 *
 * Deliberately queries `Tenant` (and its `stores`/`subscription`
 * relations) directly via the plain `PrismaService`, exactly the
 * "narrowly scoped platform service querying the Tenant table for
 * platform-level tenant management" the Phase 5 plan allows — never a
 * generic SUPER_ADMIN bypass client, never a route into another tenant's
 * business/commerce data (orders, carts, customers, uploads — none of
 * those tables are touched anywhere in this file). `withPlatformRlsBypass`
 * is NOT used here: RLS is not applied to any environment this code runs
 * against (deliberately pending, decision-gated), and per §11's own
 * three-named-caller list for that helper, platform tenant-list/lifecycle
 * reads are not one of them — adding a fourth caller here would be exactly
 * the "global withPlatformRlsBypass expansion" this phase's plan forbids.
 */
@Injectable()
export class PlatformService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  // ─── GET /platform/tenants ──────────────────────────────────────────────

  async listTenants(
    query: ListPlatformTenantsQueryDto,
  ): Promise<PaginatedResult<PlatformTenantSummaryView>> {
    const where: Prisma.TenantWhereInput = {
      ...(query.status ? { status: query.status } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.tenant.findMany({
        where,
        include: TENANT_SUMMARY_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.tenant.count({ where }),
    ]);

    return {
      items: rows.map((row) => this.toSummaryView(row)),
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.limit)),
      },
    };
  }

  // ─── GET /platform/tenants/:id ──────────────────────────────────────────

  async getTenantDetail(id: string): Promise<PlatformTenantDetailView> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
      include: TENANT_DETAIL_INCLUDE,
    });
    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }
    return this.toDetailView(tenant);
  }

  // ─── POST /platform/tenants/:id/suspend | /resume ──────────────────────

  async suspendTenant(
    actor: AuthenticatedUser,
    tenantId: string,
    justification: string,
    ip: string,
  ): Promise<PlatformTenantDetailView> {
    return this.transitionTenantStatus(
      actor,
      tenantId,
      TenantStatus.ACTIVE,
      TenantStatus.SUSPENDED,
      'tenant.suspend',
      justification,
      ip,
    );
  }

  async resumeTenant(
    actor: AuthenticatedUser,
    tenantId: string,
    justification: string,
    ip: string,
  ): Promise<PlatformTenantDetailView> {
    return this.transitionTenantStatus(
      actor,
      tenantId,
      TenantStatus.SUSPENDED,
      TenantStatus.ACTIVE,
      'tenant.resume',
      justification,
      ip,
    );
  }

  /**
   * The one lifecycle primitive W3 implements: `ACTIVE <-> SUSPENDED`
   * only (decision, this session's W3 scope) — `PENDING_DELETION`/
   * `DELETED` are out of scope and rejected here exactly like any other
   * wrong-current-state, not specially recognized.
   *
   * All 6 steps run inside ONE `$transaction`, per the required flow:
   * resolve tenant -> validate current state -> CAS update -> write
   * PlatformAuditLog -> re-read for the response -> commit. If the audit
   * insert throws for any reason, the whole transaction — including the
   * status change — rolls back; there is no separate, best-effort audit
   * write after the fact.
   *
   * Unlike `OrdersService.transitionOrderWithHistory`'s CAS (which treats
   * losing the race as a silent, safe no-op — appropriate for high-
   * frequency customer/webhook races), a wrong-current-state or lost race
   * here throws `ConflictException`. A platform admin's suspend/resume is
   * a rare, single-actor, deliberately-audited action; silently no-op'ing
   * an already-suspended tenant could mask the operator's mistake instead
   * of surfacing it. This is a deliberate, documented divergence from the
   * Order convention, not an oversight.
   */
  private async transitionTenantStatus(
    actor: AuthenticatedUser,
    tenantId: string,
    from: TenantStatus,
    to: TenantStatus,
    action: 'tenant.suspend' | 'tenant.resume',
    justification: string,
    ip: string,
  ): Promise<PlatformTenantDetailView> {
    const result = await this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.findUnique({ where: { id: tenantId } });
      if (!tenant) {
        throw new NotFoundException('Tenant not found');
      }
      if (tenant.status !== from) {
        throw new ConflictException(
          `Tenant is not ${from} (current status: ${tenant.status}) — cannot transition to ${to}`,
        );
      }

      const cas = await tx.tenant.updateMany({
        where: { id: tenantId, status: from },
        data: { status: to },
      });
      if (cas.count !== 1) {
        // Lost a concurrent race between the check above and this
        // statement — genuinely a conflict for this rare, deliberate
        // action, not a race to absorb silently.
        throw new ConflictException(
          'Tenant status changed concurrently — retry',
        );
      }

      await this.auditService.logPlatformAction(tx, {
        actorUserId: actor.id,
        action,
        targetType: 'Tenant',
        targetId: tenantId,
        tenantId,
        justification,
        metadata: { fromStatus: from, toStatus: to },
        ip,
      });

      const updated = await tx.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        include: TENANT_DETAIL_INCLUDE,
      });
      return this.toDetailView(updated);
    });
    // Routing cache stores tenantId/storeId keyed by hostname, never an
    // authorization result — but a suspend/resume must not wait for TTL
    // before the next storefront request re-reads Tenant.status.
    clearStorefrontRoutingCache();
    return result;
  }

  // ─── GET /platform/audit ────────────────────────────────────────────────
  // Reads PlatformAuditLog ONLY — TenantAuditLog is never referenced
  // anywhere in this file, let alone exposed here (decision P5-D3: the two
  // logs and their read surfaces stay fully separate).

  async listPlatformAudit(
    query: ListPlatformAuditQueryDto,
  ): Promise<PaginatedResult<PlatformAuditLogEntryView>> {
    const where: Prisma.PlatformAuditLogWhereInput = {
      ...(query.tenantId ? { tenantId: query.tenantId } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.platformAuditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.platformAuditLog.count({ where }),
    ]);

    return {
      items: rows.map((row) => ({
        id: row.id,
        actorUserId: row.actorUserId,
        action: row.action,
        targetType: row.targetType,
        targetId: row.targetId,
        tenantId: row.tenantId,
        justification: row.justification,
        metadata: row.metadata,
        ip: row.ip,
        createdAt: row.createdAt,
      })),
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.limit)),
      },
    };
  }

  // ─── View assembly (field-by-field — never a spread) ───────────────────

  private toSummaryView(tenant: TenantSummaryRow): PlatformTenantSummaryView {
    return {
      id: tenant.id,
      slug: tenant.slug,
      status: tenant.status,
      createdAt: tenant.createdAt,
      storeCount: tenant._count.stores,
    };
  }

  private toDetailView(tenant: TenantDetailRow): PlatformTenantDetailView {
    return {
      id: tenant.id,
      slug: tenant.slug,
      status: tenant.status,
      createdAt: tenant.createdAt,
      updatedAt: tenant.updatedAt,
      stores: tenant.stores.map((store) => ({
        id: store.id,
        slug: store.slug,
        name: store.name,
        status: store.status,
        isPrimary: store.isPrimary,
      })),
      subscription: tenant.subscription
        ? { status: tenant.subscription.status }
        : null,
    };
  }
}

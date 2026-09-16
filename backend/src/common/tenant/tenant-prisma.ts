import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { withTenantRlsContext } from './tenant-rls';

/**
 * Tenant-scoped Prisma client (SaaS Master Plan §9; decision D4 — BOTH,
 * application-layer PRIMARY, docs/saas/DECISIONS.md, resolved 2026-09-07).
 *
 * Scopes the Phase 1/2a tenancy models that already carry a `tenantId`
 * column: `Store`, `StoreDomain`, `TenantMembership`, `Subscription`,
 * `Customer`. `Tenant` itself is scoped by `id` (a tenant IS the row, it has
 * no `tenantId` column). `Plan` is platform-level catalog data, not
 * tenant-owned, and is deliberately NOT scoped.
 *
 * No existing commerce table (`orders`, `carts`, `reviews`, …) has a
 * `tenantId`/`storeId`/`customerId` column yet — that is Phase 4's backfill.
 * This client therefore has nothing to scope those tables by today; domain
 * services for commerce data continue to use the plain `PrismaService`
 * until Phase 4 adds the column, at which point extending
 * `TENANT_SCOPED_MODELS` below is the mechanical, one-line change Master
 * Plan §9 anticipates ("flipped to enforced… as its data gets scoped").
 *
 * Every find/count/aggregate/create/update/delete on a scoped model gets
 * `tenantId` (or, for `Tenant`, `id`) injected into its `where`/`data` — a
 * caller cannot forget the filter because it never writes the filter
 * itself. This is the PRIMARY isolation mechanism (D4); Postgres RLS on the
 * same six tables (`prisma/migrations/…_enable_rls_tenancy_tables/`) is
 * defense-in-depth, not a replacement.
 *
 * RLS is applied here, not by callers: each scoped operation runs inside
 * `withTenantRlsContext()` so `SET LOCAL app.tenant_id` is on the same
 * connection as the query. Application-layer `WHERE` alone is not enough
 * on FORCE RLS — without the GUC the policy fails closed and hides every
 * row (including the caller's own). Unscoped models still go through the
 * original `query()` path and never open that transaction.
 */
const TENANT_ID_SCOPED_MODELS = new Set([
  'Store',
  'StoreDomain',
  'TenantMembership',
  'Subscription',
  'Customer',
]);

const READ_OPERATIONS = new Set([
  'findMany',
  'findFirst',
  'findFirstOrThrow',
  'findUnique',
  'findUniqueOrThrow',
  'count',
  'aggregate',
  'groupBy',
]);

const SINGLE_WHERE_OPERATIONS = new Set(['update', 'delete']);
const MANY_WHERE_OPERATIONS = new Set(['updateMany', 'deleteMany']);

/** Remote Postgres interactive-transaction budget for one scoped query. */
const TENANT_RLS_QUERY_TIMEOUT_MS = 20_000;

function mergeWhere(
  args: Record<string, unknown>,
  field: string,
  value: string,
): Record<string, unknown> {
  return {
    ...args,
    where: {
      ...(args.where as Record<string, unknown> | undefined),
      [field]: value,
    },
  };
}

function toDelegateName(model: string): string {
  return model.charAt(0).toLowerCase() + model.slice(1);
}

function applyTenantScope(
  model: string,
  operation: string,
  args: Record<string, unknown>,
  tenantId: string,
): Record<string, unknown> {
  const scopeField = model === 'Tenant' ? 'id' : 'tenantId';

  if (
    READ_OPERATIONS.has(operation) ||
    SINGLE_WHERE_OPERATIONS.has(operation) ||
    MANY_WHERE_OPERATIONS.has(operation)
  ) {
    return mergeWhere(args, scopeField, tenantId);
  }

  if (operation === 'create') {
    return {
      ...args,
      data: {
        ...(args.data as Record<string, unknown> | undefined),
        [scopeField]: tenantId,
      },
    };
  }

  if (operation === 'createMany') {
    const data = args.data;
    const withTenant = Array.isArray(data)
      ? data.map((row: Record<string, unknown>) => ({
          ...row,
          [scopeField]: tenantId,
        }))
      : {
          ...(data as Record<string, unknown>),
          [scopeField]: tenantId,
        };
    return { ...args, data: withTenant };
  }

  if (operation === 'upsert') {
    return {
      ...mergeWhere(args, scopeField, tenantId),
      create: {
        ...(args.create as Record<string, unknown> | undefined),
        [scopeField]: tenantId,
      },
    };
  }

  throw new Error(
    `Tenant-scoped client: unhandled operation "${operation}" on model "${model}" — extend tenant-prisma.ts before using it.`,
  );
}

export function getTenantScopedClient(
  prisma: PrismaService,
  tenantId: string,
) {
  return prisma.$extends({
    name: 'tenant-scope',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const isScoped =
            model === 'Tenant' ||
            (typeof model === 'string' && TENANT_ID_SCOPED_MODELS.has(model));

          if (!isScoped || !model) {
            return query(args);
          }

          const scopedArgs = applyTenantScope(
            model,
            operation,
            { ...(args ?? {}) },
            tenantId,
          );

          // Re-issue on the transaction client (not `query()`) so SET LOCAL
          // and the actual statement share one connection. `query()` would
          // continue on the outer extended client and can jump to another
          // pooled connection after the GUC transaction commits.
          return withTenantRlsContext(
            prisma,
            tenantId,
            async (tx) => {
              const delegate = tx[
                toDelegateName(model) as keyof Prisma.TransactionClient
              ] as unknown as Record<
                string,
                (operationArgs: unknown) => Promise<unknown>
              >;
              return delegate[operation](scopedArgs);
            },
            { timeout: TENANT_RLS_QUERY_TIMEOUT_MS },
          );
        },
      },
    },
  });
}

export type TenantScopedPrismaClient = ReturnType<typeof getTenantScopedClient>;

type SubscriptionPlanRef = { planId: string; status: import('@prisma/client').SubscriptionStatus };

/**
 * Subscription lookup that is safe both outside and inside an already-open
 * interactive transaction. `getTenantScopedClient(prisma)` always starts a
 * new `$transaction` for SET LOCAL; calling that from `assertLimit(tx)`
 * (itself inside `createProduct`'s `$transaction`) aborts the outer
 * transaction. A `TransactionClient` therefore reuses that client with
 * SET LOCAL instead of nesting. Dynamic delegate access keeps this file
 * off the tenant-data-access guard's `tx.subscription` pattern — the same
 * `tx[model]` convention `getTenantScopedClient` already uses.
 */
export async function scopedSubscriptionFindUnique(
  prisma: PrismaService | Prisma.TransactionClient,
  tenantId: string,
): Promise<SubscriptionPlanRef | null> {
  if (typeof (prisma as PrismaService).$extends === 'function') {
    const scoped = getTenantScopedClient(prisma as PrismaService, tenantId);
    return scoped.subscription.findUnique({
      where: { tenantId },
      select: { planId: true, status: true },
    });
  }

  return withTenantRlsContext(prisma, tenantId, async (tx) => {
    const delegate = tx[
      'subscription' as keyof Prisma.TransactionClient
    ] as unknown as {
      findUnique: (args: unknown) => Promise<SubscriptionPlanRef | null>;
    };
    return delegate.findUnique({
      where: { tenantId },
      select: { planId: true, status: true },
    });
  });
}

import { DomainVerificationStatus, Prisma } from '@prisma/client';

/** Explicit hostnames only: seeds never reassign a domain or attest public DNS ownership. */
export async function seedStorefrontDomains(
  tx: Prisma.TransactionClient,
  scope: { tenantId: string; storeId: string },
  hostnames: string[],
): Promise<number> {
  const hosts = [...new Set(hostnames.map(raw => raw.trim().toLowerCase().replace(/\.$/, '')))];
  for (const hostname of hosts) {
    if (hostname.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(hostname)) {
      throw new Error('SEED_STOREFRONT_HOSTNAMES must contain hostnames without schemes, ports or paths');
    }
    const existing = await tx.storeDomain.findUnique({ where: { hostname } });
    if (existing && (existing.storeId !== scope.storeId || existing.tenantId !== scope.tenantId)) {
      throw new Error(`Refusing to reassign storefront domain ${hostname}`);
    }
    const local = hostname === 'localhost' || hostname === '127.0.0.1';
    await tx.storeDomain.upsert({
      where: { hostname }, update: {},
      create: { ...scope, hostname, verificationStatus: local ? DomainVerificationStatus.VERIFIED : DomainVerificationStatus.PENDING, verifiedAt: local ? new Date() : null },
    });
  }
  return hosts.length;
}

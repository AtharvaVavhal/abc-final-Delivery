import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Interactive `$transaction` budget for remote Postgres. Prisma's default
 * is 5s; Oregon-hosted writes that SET LOCAL + entitlement/limit + create
 * + audit routinely cross that and surface as a generic 500.
 */
export const PRISMA_TX_MAX_WAIT_MS = 10_000;
export const PRISMA_TX_TIMEOUT_MS = 20_000;

/**
 * Sole database access point for the whole backend (PostgreSQL via Prisma —
 * see docs/architecture/BLUEPRINT-v1.2.md §16). Registered globally by
 * PrismaModule so no other module needs to import it explicitly.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      transactionOptions: {
        maxWait: PRISMA_TX_MAX_WAIT_MS,
        timeout: PRISMA_TX_TIMEOUT_MS,
      },
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Prisma connected to PostgreSQL');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}

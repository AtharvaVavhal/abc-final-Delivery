import {
  Controller,
  Get,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Public } from '../decorators/public.decorator';
import { SkipHttpThrottle } from '../throttling/throttle.decorators';
import { PrismaService } from '../database/prisma.service';

interface HealthStatus {
  status: 'ok';
  timestamp: string;
}

/**
 * GET /health — required by the frozen deployment topology (§30: Sentry +
 * GET /health + external uptime monitor). The `check` handler deliberately
 * never touches PrismaService: an uptime monitor must be able to
 * distinguish "process is up" from "database is reachable" as two
 * different failure modes — see GET /health/deep for the latter.
 */
@SkipHttpThrottle()
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  check(): HealthStatus {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  /**
   * GET /health/deep — runs a lightweight real query (not just "process is
   * alive") so a platform health-check-gated rollback, or an uptime pinger
   * pointed here instead of /health, actually reflects DB reachability. 503
   * on failure carries no error detail (no connection string, no raw
   * Postgres error) — just a generic message; the real cause is server-side
   * logged only, same convention as HttpExceptionFilter.
   */
  @Public()
  @Get('deep')
  async checkDeep(): Promise<HealthStatus> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch (error) {
      this.logger.error(
        'Deep health check failed: database unreachable',
        error instanceof Error ? error.stack : error,
      );
      throw new ServiceUnavailableException('Service unavailable');
    }
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}

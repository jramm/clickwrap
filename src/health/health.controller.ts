/**
 * Liveness & readiness probes for container orchestration (docker-compose healthcheck,
 * Kubernetes livenessProbe/readinessProbe). Deliberately NOT part of either OpenAPI surface —
 * it is infrastructure, not an API contract (build-documents.ts includes only the feature
 * modules, so this controller never leaks into openapi.admin.json / openapi.integration.json).
 *
 * - GET /health       — cheap liveness: process is up, no I/O. Never fails on a DB blip, so a
 *                       transient database outage does not trigger a liveness-driven restart.
 * - GET /health/ready — readiness: with the `prisma` driver it pings the database (SELECT 1) and
 *                       returns 503 when the connection is down; with the in-memory driver there
 *                       is no database to check.
 */
import { Controller, Get, Optional, ServiceUnavailableException } from '@nestjs/common';
import { repositoryDriver } from '../persistence/repository.module.js';
import { PrismaService } from '../persistence/prisma/prisma.service.js';

@Controller('health')
export class HealthController {
  // PrismaService only exists in the DI container when REPOSITORY_DRIVER=prisma (PersistenceModule);
  // @Optional() keeps the controller resolvable under the in-memory driver too.
  constructor(@Optional() private readonly prisma?: PrismaService) {}

  @Get()
  live(): { status: string; service: string; uptime: number; timestamp: string } {
    return {
      status: 'ok',
      service: 'clickwrap-server',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  }

  @Get('ready')
  async ready(): Promise<{ status: string; database: string }> {
    if (repositoryDriver() !== 'prisma' || !this.prisma) {
      return { status: 'ready', database: 'skipped' };
    }
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ready', database: 'up' };
    } catch {
      throw new ServiceUnavailableException({ status: 'error', database: 'down' });
    }
  }
}

import { Module } from '@nestjs/common';
import { HealthController } from './health.controller.js';

/**
 * Exposes the /health probes. PrismaService (when REPOSITORY_DRIVER=prisma) is resolved from the
 * global RepositoryModule → PersistenceModule export; no imports needed here.
 */
@Module({ controllers: [HealthController] })
export class HealthModule {}

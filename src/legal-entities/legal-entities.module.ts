import { Module } from '@nestjs/common';
import { LegalEntitiesReconciler } from './legal-entities.reconciler.js';

/**
 * Wires the {@link LegalEntitiesReconciler} (an OnApplicationBootstrap step). It reconciles the
 * declarative config (config/legal-entities.json, path overridable via LEGAL_ENTITIES_CONFIG) into
 * the store at startup. The domain repositories it depends on are provided globally by
 * RepositoryModule, so this works for both the in-memory and Prisma drivers.
 */
@Module({
  providers: [LegalEntitiesReconciler],
})
export class LegalEntitiesModule {}

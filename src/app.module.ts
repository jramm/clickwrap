import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { AcceptModule } from './accept/accept.module.js';
import { AdminModule } from './admin/admin.module.js';
import { AgreementsModule } from './agreements/agreements.module.js';
import { AcceptAssetsModule } from './accept-assets/accept-assets.module.js';
import { AdminUiStaticModule } from './admin-ui-static/admin-ui-static.module.js';
import { AdminAuthModule } from './common/auth/admin-auth.module.js';
import { DomainErrorFilter } from './common/http/domain-error.filter.js';
import { ComplianceModule } from './compliance/compliance.module.js';
import { ConsentModule } from './consent/consent.module.js';
import { EventsModule } from './events/events.module.js';
import { HealthModule } from './health/health.module.js';
import { LegalEntitiesModule } from './legal-entities/legal-entities.module.js';
import { RepositoryModule } from './persistence/repository.module.js';
import { EmailModule } from './plugins/email/email.module.js';
import { FileStorageModule } from './plugins/file-storage/file-storage.module.js';
import { SweeperModule } from './sweeper/sweeper.module.js';

/**
 * Composition root of the service.
 *
 * RepositoryModule.forRoot() (global) binds all persistence ports depending on the
 * REPOSITORY_DRIVER env var:
 *  - inmemory (default) → the service starts without Postgres (dev/demo/boot tests),
 *  - prisma → PersistenceModule (PrismaService, requires DATABASE_URL).
 *
 * Plugin-backed capabilities are wired here through their global forRoot() modules, each
 * selecting its plugin(s) from the registry (built-ins + installed packages +
 * CLICKWRAP_PLUGIN_PATHS — see docs/PLUGINS.md):
 *  - EmailModule (EMAIL_PROVIDER), FileStorageModule (FILE_STORAGE),
 *    AdminAuthModule (ADMIN_AUTH + GET /admin/auth/methods).
 *
 * DomainErrorFilter is registered here as APP_FILTER (instead of in main.ts) so that
 * TestingModule instances (test/app.boot.spec.ts) use the same error mapping too.
 */
@Module({
  imports: [
    // Optionally serves the admin-ui SPA under /ui (combined image; SERVE_ADMIN_UI=true) — a no-op
    // module otherwise, so the plain backend image serves only the API.
    AdminUiStaticModule.forRootFromEnv(),
    // Optionally serves an acceptance-page plugin's client bundle at /accept-assets (ACCEPT_ASSETS_DIR)
    // — a no-op module when unset, so the default self-contained page needs nothing.
    AcceptAssetsModule.forRootFromEnv(),
    ScheduleModule.forRoot(),
    RepositoryModule.forRoot(),
    FileStorageModule.forRoot(),
    AdminAuthModule.forRoot(),
    AgreementsModule,
    ConsentModule,
    ComplianceModule,
    AcceptModule,
    EmailModule.forRoot(),
    SweeperModule,
    AdminModule,
    EventsModule,
    HealthModule,
    LegalEntitiesModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: DomainErrorFilter }],
})
export class AppModule {}

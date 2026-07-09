import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { AcceptModule } from './accept/accept.module';
import { AdminModule } from './admin/admin.module';
import { AgreementsModule } from './agreements/agreements.module';
import { AdminAuthModule } from './common/auth/admin-auth.module';
import { DomainErrorFilter } from './common/http/domain-error.filter';
import { ComplianceModule } from './compliance/compliance.module';
import { ConsentModule } from './consent/consent.module';
import { CustomerSyncModule } from './customer-sync/customer-sync.module';
import { EventsModule } from './events/events.module';
import { RepositoryModule } from './persistence/repository.module';
import { EmailModule } from './plugins/email/email.module';
import { FileStorageModule } from './plugins/file-storage/file-storage.module';
import { SweeperModule } from './sweeper/sweeper.module';

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
    CustomerSyncModule.forRoot(),
    AdminModule,
    EventsModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: DomainErrorFilter }],
})
export class AppModule {}

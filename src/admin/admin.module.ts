import { Module } from '@nestjs/common';
import { AcceptModule } from '../accept/accept.module';
import { AgreementsModule } from '../agreements/agreements.module';
import { CustomerServiceModule } from '../customers/customer-service.module';
import { AdminController } from './admin.controller';
import { AudienceAdminService } from './audience-admin.service';
import { CustomerVersionStateAdminService } from './customer-version-state-admin.service';
import { DashboardService } from './dashboard.service';
import { DefaultEmailTemplateSeeder } from './default-email-template.seeder';
import { DocumentTypeAdminService } from './document-type-admin.service';
import { EmailTemplateAdminService } from './email-template-admin.service';
import { HistoryService } from './history.service';
import { ManualAcceptanceService } from './manual-acceptance.service';
import { OverviewService } from './overview.service';
import { VersionCustomersService } from './version-customers.service';

/**
 * Admin module: operations — overview, history, manual recording, deadlines/reminders,
 * publish route, and CRUD for the dynamic entities (audiences, document types).
 *
 * Imports the agreements module (PublishService + module-owned ports: PdfStorage, RolloutNotifier,
 * AdminAuditRepo). Domain repositories/clock are provided globally by the integration agent.
 */
@Module({
  imports: [AgreementsModule, CustomerServiceModule, AcceptModule],
  controllers: [AdminController],
  providers: [
    OverviewService,
    DashboardService,
    VersionCustomersService,
    HistoryService,
    ManualAcceptanceService,
    CustomerVersionStateAdminService,
    AudienceAdminService,
    DocumentTypeAdminService,
    EmailTemplateAdminService,
    DefaultEmailTemplateSeeder,
  ],
})
export class AdminModule {}

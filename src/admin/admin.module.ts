import { Module } from '@nestjs/common';
import { AcceptModule } from '../accept/accept.module.js';
import { AgreementsModule } from '../agreements/agreements.module.js';
import { CustomerServiceModule } from '../customers/customer-service.module.js';
import { SignedDocumentsModule } from '../signed-documents/signed-documents.module.js';
import { SignedDocumentsAdminController } from '../signed-documents/signed-documents-admin.controller.js';
import { AdminController } from './admin.controller.js';
import { AudienceAdminService } from './audience-admin.service.js';
import { CustomerVersionStateAdminService } from './customer-version-state-admin.service.js';
import { DashboardService } from './dashboard.service.js';
import { DefaultEmailTemplateSeeder } from './default-email-template.seeder.js';
import { DocumentTypeAdminService } from './document-type-admin.service.js';
import { EmailTemplateAdminService } from './email-template-admin.service.js';
import { HistoryService } from './history.service.js';
import { ManualAcceptanceService } from './manual-acceptance.service.js';
import { VersionCustomersService } from './version-customers.service.js';

/**
 * Admin module: operations — per-version dashboard, history, manual recording, deadlines/reminders,
 * publish route, and CRUD for the dynamic entities (audiences, document types).
 *
 * Imports the agreements module (PublishService + module-owned ports: PdfStorage, RolloutNotifier,
 * AdminAuditRepo). Domain repositories/clock are provided globally by the integration agent.
 */
@Module({
  imports: [AgreementsModule, CustomerServiceModule, AcceptModule, SignedDocumentsModule],
  controllers: [AdminController, SignedDocumentsAdminController],
  providers: [
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

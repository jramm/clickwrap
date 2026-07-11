/**
 * Compliance gate + pending agreements + the public "latest PDF" redirect.
 * Domain tokens (TOKENS.*) come from the global RepositoryModule. PDF_URL_PROVIDER is bound via
 * alias to the PdfStorage of the agreements module (useExisting): popup PDF links therefore come
 * from the SAME presigned-URL source as upload/download — TTL 15 min (GET /versions/:id/pdf;
 * backed by the registry-selected file-storage plugin, env FILE_STORAGE).
 */
import { Module } from '@nestjs/common';
import { AgreementsModule } from '../agreements/agreements.module.js';
import { AGREEMENTS_TOKENS } from '../agreements/ports.js';
import { ComplianceController } from './compliance.controller.js';
import { ComplianceService } from './compliance.service.js';
import { IntegrationComplianceController } from './integration-compliance.controller.js';
import { IntegrationPendingAgreementsController } from './integration-pending-agreements.controller.js';
import { PendingAgreementsController } from './pending-agreements.controller.js';
import { PendingAgreementsService } from './pending-agreements.service.js';
import { PublicDocumentsController } from './public-documents.controller.js';
import { PublicDocumentsService } from './public-documents.service.js';
import { PDF_URL_PROVIDER } from './ports/pdf-url-provider.js';

@Module({
  imports: [AgreementsModule],
  controllers: [
    ComplianceController,
    IntegrationComplianceController,
    IntegrationPendingAgreementsController,
    PendingAgreementsController,
    PublicDocumentsController,
  ],
  providers: [
    ComplianceService,
    PendingAgreementsService,
    PublicDocumentsService,
    // PdfStorage structurally satisfies PdfUrlProvider (getPresignedUrl) — deliberately an alias, not a wrapper.
    { provide: PDF_URL_PROVIDER, useExisting: AGREEMENTS_TOKENS.PdfStorage },
  ],
  exports: [ComplianceService, PendingAgreementsService],
})
export class ComplianceModule {}

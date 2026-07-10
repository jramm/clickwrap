/**
 * Compliance gate + pending agreements + the public "latest PDF" redirect.
 * Domain tokens (TOKENS.*) come from the global RepositoryModule. PDF_URL_PROVIDER is bound via
 * alias to the PdfStorage of the agreements module (useExisting): popup PDF links therefore come
 * from the SAME presigned-URL source as upload/download — TTL 15 min (GET /versions/:id/pdf;
 * backed by the registry-selected file-storage plugin, env FILE_STORAGE).
 */
import { Module } from '@nestjs/common';
import { AgreementsModule } from '../agreements/agreements.module';
import { AGREEMENTS_TOKENS } from '../agreements/ports';
import { ComplianceController } from './compliance.controller';
import { ComplianceService } from './compliance.service';
import { IntegrationComplianceController } from './integration-compliance.controller';
import { PendingAgreementsController } from './pending-agreements.controller';
import { PendingAgreementsService } from './pending-agreements.service';
import { PublicDocumentsController } from './public-documents.controller';
import { PublicDocumentsService } from './public-documents.service';
import { PDF_URL_PROVIDER } from './ports/pdf-url-provider';

@Module({
  imports: [AgreementsModule],
  controllers: [
    ComplianceController,
    IntegrationComplianceController,
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

/**
 * Signed-documents feature (externally-signed document evidence archive).
 *
 * Provides the shared {@link SignedDocumentService} used by BOTH API surfaces. The controllers are
 * registered on their owning feature modules so the OpenAPI split stays clean:
 *  - {@link SignedDocumentsAdminController} on {@link AdminModule} (admin spec, AdminGuard),
 *  - {@link SignedDocumentsIntegrationController} on {@link ConsentModule} (integration spec,
 *    ServiceTokenGuard).
 *
 * Imports AgreementsModule for the PdfStorage port (FileStorage plugin behind the host-side
 * contentHash adapter); the domain repositories, Clock and AdminAuditRepo come from the global
 * RepositoryModule.
 */
import { Module } from '@nestjs/common';
import { AgreementsModule } from '../agreements/agreements.module.js';
import { SignedDocumentService } from './signed-document.service.js';

@Module({
  imports: [AgreementsModule],
  providers: [SignedDocumentService],
  exports: [SignedDocumentService],
})
export class SignedDocumentsModule {}

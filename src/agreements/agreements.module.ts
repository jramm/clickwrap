import { Module } from '@nestjs/common';
import { PLUGIN_DI_TOKENS, type FileStorage } from '../plugin-sdk/index.js';
import { AgreementRolloutNotifier } from '../plugins/email/core/agreement-rollout-notifier.js';
import { AgreementsAdminController } from './agreements-admin.controller.js';
import { DocumentService } from './document.service.js';
import { FileStoragePdfAdapter } from './file-storage-pdf.adapter.js';
import { AGREEMENTS_TOKENS } from './ports.js';
import { PublishService } from './publish.service.js';
import { VersionService } from './version.service.js';

/**
 * Agreements module: documents & versions, publish/rollout.
 *
 * Domain repositories, Clock and AdminAuditRepo (ADMIN_AUDIT_TOKEN) come from the global
 * RepositoryModule. Module-local ports:
 *  - PdfStorage: the registry-selected file-storage plugin (env FILE_STORAGE; built-ins
 *    memory | local, third-party plugins via docs/PLUGINS.md) provided globally by
 *    FileStorageModule, behind the FileStoragePdfAdapter (contentHash/fileSize are computed
 *    host-side, never trusted from a plugin). Presigned URLs keep the 15-minute-TTL semantics of
 *    GET /versions/:id/pdf.
 *  - RolloutNotifier: AgreementRolloutNotifier (adapter onto the AgreementEmailService; recipient
 *    logic — all Customer.contactEmails). Provided by the @Global EmailModule; the selected e-mail
 *    provider (EMAIL_PROVIDER) decides whether anything is really sent.
 */
@Module({
  controllers: [AgreementsAdminController],
  providers: [
    DocumentService,
    VersionService,
    PublishService,
    {
      provide: AGREEMENTS_TOKENS.PdfStorage,
      useFactory: (storage: FileStorage) => new FileStoragePdfAdapter(storage),
      inject: [PLUGIN_DI_TOKENS.FileStorage],
    },
    { provide: AGREEMENTS_TOKENS.RolloutNotifier, useExisting: AgreementRolloutNotifier },
  ],
  exports: [
    DocumentService,
    VersionService,
    PublishService,
    AGREEMENTS_TOKENS.PdfStorage,
    AGREEMENTS_TOKENS.RolloutNotifier,
  ],
})
export class AgreementsModule {}

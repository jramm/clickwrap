/**
 * Binds the domain ports (src/domain/ports.ts, DI tokens from src/persistence/tokens.ts) to the
 * Prisma implementations in this directory + Clock to SystemClock (server time, see
 * CONVENTIONS.md). Additionally the module-local persistence ports: AdminAuditRepo (agreements),
 * IdempotencyStore (consent), OutboundEmailRepo (e-mail plugin) and the shared EscalationLog
 * (src/common/escalation). Made globally available via src/persistence/repository.module.ts
 * (REPOSITORY_DRIVER=prisma).
 */
import { Module } from '@nestjs/common';
import { ADMIN_AUDIT_TOKEN } from '../../agreements/audit.js';
import { ESCALATION_LOG } from '../../common/escalation/escalation-log.js';
import { CONSENT_TOKENS } from '../../consent/ports.js';
import { EventRecorder } from '../../events/event-recorder.js';
import { SystemClock } from '../../domain/clock.js';
import { EMAIL_TOKENS } from '../../plugins/email/core/email-delivery-provider.js';
import { TOKENS } from '../tokens.js';
import { PrismaAcceptanceLinkRepo } from './acceptance-link.repo.js';
import { PrismaAcceptanceRepo } from './acceptance.repo.js';
import { PrismaAdminAuditRepo } from './admin-audit.repo.js';
import { PrismaAgreementDocumentRepo } from './agreement-document.repo.js';
import { PrismaAgreementVersionRepo } from './agreement-version.repo.js';
import { PrismaAudienceRepo } from './audience.repo.js';
import { PrismaCustomerRepo } from './customer.repo.js';
import { PrismaCustomerVersionStateRepo } from './customer-version-state.repo.js';
import { PrismaDocumentTypeRepo } from './document-type.repo.js';
import { PrismaEmailTemplateRepo } from './email-template.repo.js';
import { PrismaEscalationLog } from './escalation-log.repo.js';
import { PrismaEventRepo } from './event.repo.js';
import { PrismaIdempotencyStore } from './idempotency-store.repo.js';
import { PrismaNotificationEventRepo } from './notification-event.repo.js';
import { PrismaObjectionRepo } from './objection.repo.js';
import { PrismaOutboundEmailRepo } from './outbound-email.repo.js';
import { PrismaSignedDocumentRepo } from './signed-document.repo.js';
import { PrismaService } from './prisma.service.js';

@Module({
  providers: [
    PrismaService,
    { provide: TOKENS.AudienceRepo, useClass: PrismaAudienceRepo },
    { provide: TOKENS.DocumentTypeRepo, useClass: PrismaDocumentTypeRepo },
    { provide: TOKENS.EmailTemplateRepo, useClass: PrismaEmailTemplateRepo },
    { provide: TOKENS.AgreementDocumentRepo, useClass: PrismaAgreementDocumentRepo },
    { provide: TOKENS.AgreementVersionRepo, useClass: PrismaAgreementVersionRepo },
    { provide: TOKENS.CustomerRepo, useClass: PrismaCustomerRepo },
    { provide: TOKENS.CustomerVersionStateRepo, useClass: PrismaCustomerVersionStateRepo },
    { provide: TOKENS.AcceptanceRepo, useClass: PrismaAcceptanceRepo },
    { provide: TOKENS.ObjectionRepo, useClass: PrismaObjectionRepo },
    { provide: TOKENS.NotificationEventRepo, useClass: PrismaNotificationEventRepo },
    { provide: TOKENS.AcceptanceLinkRepo, useClass: PrismaAcceptanceLinkRepo },
    { provide: TOKENS.SignedDocumentRepo, useClass: PrismaSignedDocumentRepo },
    { provide: TOKENS.EventRepo, useClass: PrismaEventRepo },
    { provide: TOKENS.Clock, useClass: SystemClock },
    { provide: ADMIN_AUDIT_TOKEN, useClass: PrismaAdminAuditRepo },
    { provide: CONSENT_TOKENS.IdempotencyStore, useClass: PrismaIdempotencyStore },
    { provide: EMAIL_TOKENS.OutboundEmailRepo, useClass: PrismaOutboundEmailRepo },
    { provide: ESCALATION_LOG, useClass: PrismaEscalationLog },
    EventRecorder,
  ],
  exports: [
    PrismaService,
    TOKENS.AudienceRepo,
    TOKENS.DocumentTypeRepo,
    TOKENS.EmailTemplateRepo,
    TOKENS.AgreementDocumentRepo,
    TOKENS.AgreementVersionRepo,
    TOKENS.CustomerRepo,
    TOKENS.CustomerVersionStateRepo,
    TOKENS.AcceptanceRepo,
    TOKENS.ObjectionRepo,
    TOKENS.NotificationEventRepo,
    TOKENS.AcceptanceLinkRepo,
    TOKENS.SignedDocumentRepo,
    TOKENS.EventRepo,
    TOKENS.Clock,
    ADMIN_AUDIT_TOKEN,
    CONSENT_TOKENS.IdempotencyStore,
    EMAIL_TOKENS.OutboundEmailRepo,
    ESCALATION_LOG,
    EventRecorder,
  ],
})
export class PersistenceModule {}

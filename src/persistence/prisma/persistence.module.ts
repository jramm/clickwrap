/**
 * Binds the domain ports (src/domain/ports.ts, DI tokens from src/persistence/tokens.ts) to the
 * Prisma implementations in this directory + Clock to SystemClock (server time, see
 * CONVENTIONS.md). Additionally the module-local persistence ports: AdminAuditRepo (agreements),
 * IdempotencyStore (consent), OutboundEmailRepo (e-mail plugin) and the shared EscalationLog
 * (src/common/escalation). Made globally available via src/persistence/repository.module.ts
 * (REPOSITORY_DRIVER=prisma).
 */
import { Module } from '@nestjs/common';
import { ADMIN_AUDIT_TOKEN } from '../../agreements/audit';
import { ESCALATION_LOG } from '../../common/escalation/escalation-log';
import { CONSENT_TOKENS } from '../../consent/ports';
import { SystemClock } from '../../domain/clock';
import { EMAIL_TOKENS } from '../../plugins/email/core/email-delivery-provider';
import { TOKENS } from '../tokens';
import { PrismaAcceptanceLinkRepo } from './acceptance-link.repo';
import { PrismaAcceptanceRepo } from './acceptance.repo';
import { PrismaAdminAuditRepo } from './admin-audit.repo';
import { PrismaAgreementDocumentRepo } from './agreement-document.repo';
import { PrismaAgreementVersionRepo } from './agreement-version.repo';
import { PrismaAudienceRepo } from './audience.repo';
import { PrismaCustomerRepo } from './customer.repo';
import { PrismaCustomerVersionStateRepo } from './customer-version-state.repo';
import { PrismaDocumentTypeRepo } from './document-type.repo';
import { PrismaEmailTemplateRepo } from './email-template.repo';
import { PrismaEscalationLog } from './escalation-log.repo';
import { PrismaIdempotencyStore } from './idempotency-store.repo';
import { PrismaNotificationEventRepo } from './notification-event.repo';
import { PrismaObjectionRepo } from './objection.repo';
import { PrismaOutboundEmailRepo } from './outbound-email.repo';
import { PrismaService } from './prisma.service';

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
    { provide: TOKENS.Clock, useClass: SystemClock },
    { provide: ADMIN_AUDIT_TOKEN, useClass: PrismaAdminAuditRepo },
    { provide: CONSENT_TOKENS.IdempotencyStore, useClass: PrismaIdempotencyStore },
    { provide: EMAIL_TOKENS.OutboundEmailRepo, useClass: PrismaOutboundEmailRepo },
    { provide: ESCALATION_LOG, useClass: PrismaEscalationLog },
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
    TOKENS.Clock,
    ADMIN_AUDIT_TOKEN,
    CONSENT_TOKENS.IdempotencyStore,
    EMAIL_TOKENS.OutboundEmailRepo,
    ESCALATION_LOG,
  ],
})
export class PersistenceModule {}

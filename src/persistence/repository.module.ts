/**
 * Global persistence wiring (composition root of the ports) — env `REPOSITORY_DRIVER`:
 *
 *  - `inmemory` (default): all ports run against the in-memory fakes — the service starts
 *    without Postgres (dev/demo/boot tests). CAUTION: nothing survives a restart.
 *  - `prisma`: binds the PersistenceModule (PrismaService + Prisma repos, needs DATABASE_URL).
 *
 * @Global so all feature modules (Consent/Agreements/Admin/Compliance/Email/Sweeper) can
 * inject the domain tokens (TOKENS.*) and the module-local persistence ports (AdminAuditRepo,
 * IdempotencyStore, OutboundEmailRepo, ESCALATION_LOG) without their own imports.
 */
import { Global, Module, type DynamicModule, type Provider } from '@nestjs/common';
import { ADMIN_AUDIT_TOKEN, InMemoryAdminAuditRepo } from '../agreements/audit.js';
import { ESCALATION_LOG } from '../common/escalation/escalation-log.js';
import { InMemoryEscalationLog } from '../common/escalation/escalation-log.inmemory.js';
import { InMemoryIdempotencyStore } from '../consent/inmemory.js';
import { CONSENT_TOKENS } from '../consent/ports.js';
import { EventRecorder } from '../events/event-recorder.js';
import { SystemClock } from '../domain/clock.js';
import type { AgreementDocumentRepo, CustomerRepo, DocumentTypeRepo } from '../domain/ports.js';
import { EMAIL_TOKENS } from '../plugins/email/core/email-delivery-provider.js';
import { InMemoryOutboundEmailRepo } from '../plugins/email/core/outbound-email.repo.inmemory.js';
import {
  InMemoryAcceptanceLinkRepo,
  InMemoryAcceptanceRepo,
  InMemoryAgreementDocumentRepo,
  InMemoryAgreementVersionRepo,
  InMemoryAudienceRepo,
  InMemoryCustomerRepo,
  InMemoryCustomerVersionStateRepo,
  InMemoryDocumentTypeRepo,
  InMemoryEmailTemplateRepo,
  InMemoryEventRepo,
  InMemoryNotificationEventRepo,
  InMemoryObjectionRepo,
  InMemorySignedDocumentRepo,
} from './inmemory/index.js';
import { PersistenceModule } from './prisma/persistence.module.js';
import { TOKENS } from './tokens.js';

export type RepositoryDriver = 'inmemory' | 'prisma';

/** Reads and validates REPOSITORY_DRIVER (default: inmemory — start without Postgres possible). */
export const repositoryDriver = (): RepositoryDriver => {
  const raw = (process.env.REPOSITORY_DRIVER ?? 'inmemory').toLowerCase();
  if (raw !== 'inmemory' && raw !== 'prisma') {
    throw new Error(`Unknown REPOSITORY_DRIVER "${raw}" — allowed: inmemory | prisma`);
  }
  return raw;
};

const inMemoryProviders: Provider[] = [
  { provide: TOKENS.AgreementDocumentRepo, useClass: InMemoryAgreementDocumentRepo },
  {
    provide: TOKENS.AgreementVersionRepo,
    useFactory: (documents: AgreementDocumentRepo) => new InMemoryAgreementVersionRepo(documents),
    inject: [TOKENS.AgreementDocumentRepo],
  },
  { provide: TOKENS.CustomerRepo, useClass: InMemoryCustomerRepo },
  {
    provide: TOKENS.AudienceRepo,
    useFactory: (documents: AgreementDocumentRepo, customers: CustomerRepo) =>
      new InMemoryAudienceRepo(documents, customers),
    inject: [TOKENS.AgreementDocumentRepo, TOKENS.CustomerRepo],
  },
  {
    provide: TOKENS.DocumentTypeRepo,
    useFactory: (documents: AgreementDocumentRepo) => new InMemoryDocumentTypeRepo(documents),
    inject: [TOKENS.AgreementDocumentRepo],
  },
  {
    provide: TOKENS.EmailTemplateRepo,
    useFactory: (documentTypes: DocumentTypeRepo) => new InMemoryEmailTemplateRepo(documentTypes),
    inject: [TOKENS.DocumentTypeRepo],
  },
  { provide: TOKENS.CustomerVersionStateRepo, useClass: InMemoryCustomerVersionStateRepo },
  { provide: TOKENS.AcceptanceRepo, useClass: InMemoryAcceptanceRepo },
  { provide: TOKENS.ObjectionRepo, useClass: InMemoryObjectionRepo },
  { provide: TOKENS.NotificationEventRepo, useClass: InMemoryNotificationEventRepo },
  { provide: TOKENS.AcceptanceLinkRepo, useClass: InMemoryAcceptanceLinkRepo },
  { provide: TOKENS.SignedDocumentRepo, useClass: InMemorySignedDocumentRepo },
  { provide: TOKENS.EventRepo, useClass: InMemoryEventRepo },
  { provide: TOKENS.Clock, useClass: SystemClock },
  { provide: ADMIN_AUDIT_TOKEN, useClass: InMemoryAdminAuditRepo },
  { provide: CONSENT_TOKENS.IdempotencyStore, useClass: InMemoryIdempotencyStore },
  { provide: EMAIL_TOKENS.OutboundEmailRepo, useClass: InMemoryOutboundEmailRepo },
  { provide: ESCALATION_LOG, useClass: InMemoryEscalationLog },
  EventRecorder,
];

@Global()
@Module({})
export class RepositoryModule {
  static forRoot(): DynamicModule {
    if (repositoryDriver() === 'prisma') {
      return {
        module: RepositoryModule,
        imports: [PersistenceModule],
        exports: [PersistenceModule],
      };
    }
    return {
      module: RepositoryModule,
      providers: inMemoryProviders,
      exports: inMemoryProviders.map((p) => ('provide' in p ? p.provide : p)),
    };
  }
}

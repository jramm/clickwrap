/**
 * Consent module: active consent, objection, delivery evidence.
 * Repo/clock tokens (TOKENS.*), the IdempotencyStore and the shared ESCALATION_LOG come from the
 * global RepositoryModule (driver-dependent: Prisma or in-memory). Only ID generation is bound
 * module-locally (UUID — no persistence dependency).
 */
import { Module } from '@nestjs/common';
import { CustomerServiceModule } from '../customers/customer-service.module';
import { SignedDocumentsModule } from '../signed-documents/signed-documents.module';
import { SignedDocumentsIntegrationController } from '../signed-documents/signed-documents-integration.controller';
import { AcceptanceService } from './acceptance.service';
import { ConsentController } from './consent.controller';
import { CustomerOnboardingController } from './customer-onboarding.controller';
import { UuidIdGenerator } from './inmemory';
import { NotificationService } from './notification.service';
import { ObjectionService } from './objection.service';
import { CONSENT_TOKENS } from './ports';

@Module({
  imports: [CustomerServiceModule, SignedDocumentsModule],
  controllers: [ConsentController, CustomerOnboardingController, SignedDocumentsIntegrationController],
  providers: [
    AcceptanceService,
    ObjectionService,
    NotificationService,
    { provide: CONSENT_TOKENS.IdGenerator, useClass: UuidIdGenerator },
  ],
  // Exported for the hosted acceptance page (AcceptModule): the LINK channel goes through the
  // SAME acceptance/notification services as the portal popup.
  exports: [AcceptanceService, NotificationService],
})
export class ConsentModule {}

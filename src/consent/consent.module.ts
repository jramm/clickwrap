/**
 * Consent module: active consent, objection, delivery evidence.
 * Repo/clock tokens (TOKENS.*), the IdempotencyStore and the shared ESCALATION_LOG come from the
 * global RepositoryModule (driver-dependent: Prisma or in-memory). Only ID generation is bound
 * module-locally (UUID — no persistence dependency).
 */
import { Module } from '@nestjs/common';
import { CustomerServiceModule } from '../customers/customer-service.module.js';
import { SignedDocumentsModule } from '../signed-documents/signed-documents.module.js';
import { SignedDocumentsIntegrationController } from '../signed-documents/signed-documents-integration.controller.js';
import { AcceptanceService } from './acceptance.service.js';
import { ConsentController } from './consent.controller.js';
import { CustomerOnboardingController } from './customer-onboarding.controller.js';
import { IntegrationAcceptanceController } from './integration-acceptance.controller.js';
import { UuidIdGenerator } from './inmemory.js';
import { NotificationService } from './notification.service.js';
import { ObjectionService } from './objection.service.js';
import { CONSENT_TOKENS } from './ports.js';

@Module({
  imports: [CustomerServiceModule, SignedDocumentsModule],
  controllers: [
    ConsentController,
    CustomerOnboardingController,
    IntegrationAcceptanceController,
    SignedDocumentsIntegrationController,
  ],
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

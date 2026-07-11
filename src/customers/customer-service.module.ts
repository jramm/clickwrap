import { Module } from '@nestjs/common';
import { AgreementRolloutNotifier } from '../plugins/email/core/agreement-rollout-notifier.js';
import { AGREEMENTS_TOKENS } from '../agreements/ports.js';
import { CustomerAdminService } from './customer-admin.service.js';

/**
 * Provider-only module for the shared {@link CustomerAdminService}. Domain repositories, Clock and
 * AdminAuditRepo come from the global RepositoryModule. The RolloutNotifier token is bound locally
 * to the globally-available AgreementRolloutNotifier (from the @Global EmailModule) — the same
 * binding AgreementsModule uses — so onboarding rollout can send acceptance-notification e-mails
 * without importing AgreementsModule (which would create an import cycle via AdminModule).
 *
 * Both the admin API (AdminModule) and the integration API (ConsentModule →
 * CustomerOnboardingController) import this module and reuse the same service implementation.
 */
@Module({
  providers: [
    CustomerAdminService,
    { provide: AGREEMENTS_TOKENS.RolloutNotifier, useExisting: AgreementRolloutNotifier },
  ],
  exports: [CustomerAdminService],
})
export class CustomerServiceModule {}

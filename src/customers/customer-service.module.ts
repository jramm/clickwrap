import { Module } from '@nestjs/common';
import { CustomerAdminService } from './customer-admin.service';

/**
 * Provider-only module for the shared {@link CustomerAdminService}. All of its dependencies come
 * from the global RepositoryModule, so it needs no imports. Both the admin API (AdminModule) and
 * the integration API (ConsentModule → CustomerOnboardingController) import this module and reuse
 * the same service implementation — no logic duplication.
 */
@Module({
  providers: [CustomerAdminService],
  exports: [CustomerAdminService],
})
export class CustomerServiceModule {}

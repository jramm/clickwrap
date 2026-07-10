/**
 * Hosted acceptance page module: the public capability-URL endpoints (`/accept/:token`) plus
 * the admin-side link minting service (endpoint lives in AdminController). Reuses the popup
 * services — PendingAgreementsService (content), NotificationService (access proof) and
 * AcceptanceService (consent) — so every evidence-chain guarantee has exactly one home.
 *
 * The page HTML itself is produced by the active `acceptance-page` plugin (env ACCEPTANCE_PAGE,
 * default `default` → the current server-rendered page), wired via AcceptancePageModule.forRoot()
 * and injected into AcceptPageController — see docs/PLUGINS.md.
 */
import { Module } from '@nestjs/common';
import { ComplianceModule } from '../compliance/compliance.module';
import { ConsentModule } from '../consent/consent.module';
import { TOKENS } from '../persistence/tokens';
import type { Clock } from '../domain/clock';
import { AcceptancePageModule } from './acceptance-page.module';
import { AcceptanceLinkAdminService } from './acceptance-link-admin.service';
import { AcceptPageService } from './accept-page.service';
import { ACCEPT_PAGE_RATE_LIMITER, AcceptPageController } from './accept-page.controller';
import { SlidingWindowRateLimiter } from './rate-limiter';

@Module({
  imports: [ComplianceModule, ConsentModule, AcceptancePageModule.forRoot()],
  controllers: [AcceptPageController],
  providers: [
    AcceptanceLinkAdminService,
    AcceptPageService,
    {
      provide: ACCEPT_PAGE_RATE_LIMITER,
      useFactory: (clock: Clock) => new SlidingWindowRateLimiter(clock),
      inject: [TOKENS.Clock],
    },
  ],
  exports: [AcceptanceLinkAdminService],
})
export class AcceptModule {}

/**
 * Sweeper module: activation sweeper (scheduled-effectiveness flip at validFrom), deadline
 * sweeper (TACIT/EXPIRED_BLOCKING) + reminder job.
 * Expects the providers for TOKENS.{CustomerVersionStateRepo, AgreementVersionRepo, AcceptanceRepo,
 * CustomerRepo, NotificationEventRepo, Clock} to come from an imported persistence module (wiring:
 * integration agent, see src/persistence/prisma/persistence.module.ts).
 *
 * ReminderMailer is bound directly to AgreementEmailService, which comes from the @Global EmailModule
 * (instantiated once in AppModule) — no import needed here.
 *
 * NEEDS (integration/persistence): SWEEPER_TOKENS.ReminderCandidateRepo is bound here with the
 * in-memory reference implementation (correct, but O(customers × states), see
 * reminder-candidate.repo.inmemory.ts). For production scale replace it with an indexed Prisma query —
 * see final report.
 */
import { Module } from '@nestjs/common';
import { AgreementEmailService } from '../plugins/email/core/agreement-email.service.js';
import { ActivationSweeperService } from './activation-sweeper.service.js';
import { DeadlineSweeperJob } from './deadline-sweeper.job.js';
import { DeadlineSweeperService } from './deadline-sweeper.service.js';
import { SWEEPER_TOKENS } from './ports.js';
import { InMemoryReminderCandidateRepo } from './reminder-candidate.repo.inmemory.js';
import { ReminderJob } from './reminder.job.js';
import { ReminderService } from './reminder.service.js';
import { RolloutNotificationJob } from './rollout-notification.job.js';
import { RolloutNotificationService } from './rollout-notification.service.js';

@Module({
  providers: [
    ActivationSweeperService,
    DeadlineSweeperService,
    DeadlineSweeperJob,
    ReminderService,
    ReminderJob,
    // Sends publish-rollout e-mails asynchronously (off the publish request). The notifier
    // (AgreementRolloutNotifier) comes from the @Global EmailModule — no import needed here.
    RolloutNotificationService,
    RolloutNotificationJob,
    { provide: SWEEPER_TOKENS.ReminderCandidateRepo, useClass: InMemoryReminderCandidateRepo },
    { provide: SWEEPER_TOKENS.ReminderMailer, useExisting: AgreementEmailService },
  ],
  exports: [ActivationSweeperService, DeadlineSweeperService, ReminderService, RolloutNotificationService],
})
export class SweeperModule {}

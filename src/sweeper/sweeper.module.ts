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
import { AgreementEmailService } from '../plugins/email/core/agreement-email.service';
import { ActivationSweeperService } from './activation-sweeper.service';
import { DeadlineSweeperJob } from './deadline-sweeper.job';
import { DeadlineSweeperService } from './deadline-sweeper.service';
import { SWEEPER_TOKENS } from './ports';
import { InMemoryReminderCandidateRepo } from './reminder-candidate.repo.inmemory';
import { ReminderJob } from './reminder.job';
import { ReminderService } from './reminder.service';

@Module({
  providers: [
    ActivationSweeperService,
    DeadlineSweeperService,
    DeadlineSweeperJob,
    ReminderService,
    ReminderJob,
    { provide: SWEEPER_TOKENS.ReminderCandidateRepo, useClass: InMemoryReminderCandidateRepo },
    { provide: SWEEPER_TOKENS.ReminderMailer, useExisting: AgreementEmailService },
  ],
  exports: [ActivationSweeperService, DeadlineSweeperService, ReminderService],
})
export class SweeperModule {}

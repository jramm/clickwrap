import { Inject, Injectable } from '@nestjs/common';
import type {
  AgreementVersionRepo,
  CustomerRepo,
  CustomerVersionStateRepo,
  NotificationEventRepo,
} from '../domain/ports';
import { TOKENS } from '../persistence/tokens';
import type { ReminderCandidate, ReminderCandidateRepo } from './ports';

/**
 * Reference implementation built solely on existing domain ports (no new port needed): iterates all
 * customers, collects their NOTIFIED states with deadlineAt <= before, and resolves the recipient via
 * the state's most recently recorded NotificationEvent. Correct, but O(customers × states) —
 * unindexed. NEEDED (integration/persistence): replace with an indexed Prisma query for production
 * scale (`WHERE state = 'NOTIFIED' AND deadlineAt <= :before`, joined with the latest
 * NotificationEvent) — see the final report.
 */
@Injectable()
export class InMemoryReminderCandidateRepo implements ReminderCandidateRepo {
  constructor(
    @Inject(TOKENS.CustomerRepo) private readonly customerRepo: CustomerRepo,
    @Inject(TOKENS.CustomerVersionStateRepo) private readonly stateRepo: CustomerVersionStateRepo,
    @Inject(TOKENS.AgreementVersionRepo) private readonly versionRepo: AgreementVersionRepo,
    @Inject(TOKENS.NotificationEventRepo) private readonly notificationEventRepo: NotificationEventRepo,
  ) {}

  async findDue(before: Date): Promise<ReminderCandidate[]> {
    const customers = await this.customerRepo.findAll();
    const candidates: ReminderCandidate[] = [];
    for (const customer of customers) {
      const states = await this.stateRepo.findByCustomer(customer.id);
      for (const state of states) {
        if (state.state !== 'NOTIFIED' || state.deadlineAt === undefined || state.deadlineAt.getTime() > before.getTime()) {
          continue;
        }
        const version = await this.versionRepo.findById(state.versionId);
        const recipient = await this.resolveRecipient(state.id);
        if (!version || recipient === undefined) {
          continue;
        }
        candidates.push({ state, customer, version, recipient });
      }
    }
    return candidates;
  }

  /** The state's most recently known NotificationEvent supplies the e-mail address for the reminder. */
  private async resolveRecipient(customerVersionStateId: string): Promise<string | undefined> {
    const events = await this.notificationEventRepo.findByState(customerVersionStateId);
    const latest = [...events].sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())[0];
    return latest?.recipient;
  }
}

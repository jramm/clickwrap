import { Inject, Injectable } from '@nestjs/common';
import type { Clock } from '../domain/clock';
import type { CustomerVersionStateRepo } from '../domain/ports';
import { TOKENS } from '../persistence/tokens';
import type { ReminderCandidate, ReminderCandidateRepo, ReminderMailer } from './ports';
import { SWEEPER_TOKENS } from './ports';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** Reminder thresholds before deadlineAt, in days, sorted ascending. */
const REMINDER_THRESHOLDS_DAYS: readonly number[] = [7, 2];

/**
 * Reminder job (runs daily): NOTIFIED and PENDING_NOTIFICATION states with a deadlineAt 7 or 2 days
 * out receive a reminder e-mail. PENDING_NOTIFICATION with a deadlineAt is the ACTIVE hard-deadline
 * case — the customer was never accessed but the deadline still applies, so we remind toward it.
 * (PASSIVE never-accessed PENDING states carry no deadlineAt and never become candidates.)
 *
 * Idempotency decision: `remindersSent` counts how many of the (ascending-sorted) thresholds have
 * already been sent — index `remindersSent` is always the next still-open threshold. This is the
 * simplest correct approach with the existing field: an additional `lastReminderAt` would be
 * redundant, because the thresholds are strictly monotonically decreasing (7 days before 2 days) and
 * a state, as long as it keeps its state value, can never cross the same threshold twice. A missed
 * run (e.g. an outage) is caught up on the next run: the while loop sends all thresholds that are by
 * then due and still open, in one pass.
 */
@Injectable()
export class ReminderService {
  constructor(
    @Inject(SWEEPER_TOKENS.ReminderCandidateRepo) private readonly candidateRepo: ReminderCandidateRepo,
    @Inject(SWEEPER_TOKENS.ReminderMailer) private readonly mailer: ReminderMailer,
    @Inject(TOKENS.CustomerVersionStateRepo) private readonly stateRepo: CustomerVersionStateRepo,
    @Inject(TOKENS.Clock) private readonly clock: Clock,
  ) {}

  /** Reminder run: fetches candidates within the widest threshold and sends due reminders. */
  async run(): Promise<void> {
    const now = this.clock.now();
    const widestThresholdDays = REMINDER_THRESHOLDS_DAYS[0];
    const horizon = new Date(now.getTime() + widestThresholdDays * MS_PER_DAY);
    const candidates = await this.candidateRepo.findDue(horizon);
    for (const candidate of candidates) {
      await this.remindOne(candidate, now);
    }
  }

  private async remindOne(candidate: ReminderCandidate, now: Date): Promise<void> {
    const { state, customer, version, recipient } = candidate;
    if (state.deadlineAt === undefined) {
      return;
    }
    const deadlineAt = state.deadlineAt;
    let remindersSent = state.remindersSent;
    while (remindersSent < REMINDER_THRESHOLDS_DAYS.length && this.isThresholdDue(deadlineAt, remindersSent, now)) {
      await this.mailer.sendReminder(customer, recipient, version, deadlineAt);
      remindersSent += 1;
    }
    if (remindersSent !== state.remindersSent) {
      // Conditional ONLY while the state is unchanged since findDue: if the customer accepted during
      // the mail send (or the version was superseded), the counter update must not overwrite the new
      // state via a full-row save. Precondition not met → no-op (worst case a repeated reminder, but
      // never a lost state). We use the OBSERVED state value as both precondition and target, so a
      // PENDING_NOTIFICATION reminder keeps the state PENDING (sending a reminder is NOT provable
      // access — notifiedAt stays untouched) and a NOTIFIED one stays NOTIFIED. deadlineAt unchanged.
      await this.stateRepo.transition(state.id, state.state, { state: state.state, remindersSent });
    }
  }

  private isThresholdDue(deadlineAt: Date, thresholdIndex: number, now: Date): boolean {
    const thresholdAt = deadlineAt.getTime() - REMINDER_THRESHOLDS_DAYS[thresholdIndex] * MS_PER_DAY;
    return now.getTime() >= thresholdAt;
  }
}

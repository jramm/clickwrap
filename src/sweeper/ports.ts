/**
 * Module-local ports of the sweeper module (not part of src/domain/ports.ts).
 * NEEDS (integration/persistence): ReminderCandidateRepo needs a concrete implementation that joins
 * CustomerVersionState (state=NOTIFIED) with Customer, AgreementVersion and the last known e-mail
 * recipient (from NotificationEvent) into a `ReminderCandidate` — see final report.
 */
import type { AgreementVersion, Customer, CustomerVersionState } from '../domain/types';

export interface ReminderCandidate {
  state: CustomerVersionState;
  customer: Customer;
  version: AgreementVersion;
  /** E-mail address for the reminder — e.g. from the state's last NotificationEvent. */
  recipient: string;
}

export interface ReminderCandidateRepo {
  /** All NOTIFIED states with deadlineAt <= before — a superset that ReminderService filters further. */
  findDue(before: Date): Promise<ReminderCandidate[]>;
}

/** Interface through which ReminderService sends reminders — satisfied by AgreementEmailService. */
export interface ReminderMailer {
  sendReminder(
    customer: Customer,
    recipient: string,
    version: AgreementVersion,
    deadlineAt: Date,
  ): Promise<{ providerRef: string }>;
}

/** DI tokens of the module-local ports (runtime wiring: integration agent). */
export const SWEEPER_TOKENS = {
  ReminderCandidateRepo: Symbol('ReminderCandidateRepo'),
  ReminderMailer: Symbol('ReminderMailer'),
} as const;

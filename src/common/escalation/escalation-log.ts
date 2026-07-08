/**
 * Shared escalation port. The escalation log is shared between the consent module and the
 * email/postmark plugin (src/plugins/email/postmark/) — both modules write into the SAME log.
 *
 * An entry is a plain note for admin/legal — not a domain object with a state machine.
 * `kind` distinguishes the sources:
 *  - OBJECTION_AFTER_PERIOD: objection raised after the deadline expired (consent module; a
 *    note only, it does not change the consent state).
 *  - EMAIL_BOUNCE: postmark bounce meaning "customer unreachable" (email/postmark plugin; the
 *    deadline explicitly does NOT start in this case). `inactivatedEmail` = postmark has
 *    permanently deactivated the recipient — do not e-mail the address again.
 */
import type { Actor } from '../auth/actor';

export type EscalationKind = 'OBJECTION_AFTER_PERIOD' | 'EMAIL_BOUNCE';

export interface EscalationEntry {
  id: string;
  kind: EscalationKind;
  /** Missing for EMAIL_BOUNCE when the message ID cannot be matched to a known send. */
  customerId?: string;
  versionId?: string;
  occurredAt: Date;
  /** OBJECTION_AFTER_PERIOD only: actor from the auth context + free text. */
  actor?: Actor;
  reason?: string;
  note?: string;
  /** EMAIL_BOUNCE only: affected e-mail address + postmark deactivation flag. */
  recipient?: string;
  inactivatedEmail?: boolean;
}

export interface EscalationLog {
  record(entry: EscalationEntry): Promise<EscalationEntry>;
  findByCustomer(customerId: string): Promise<EscalationEntry[]>;
  findAll(): Promise<EscalationEntry[]>;
}

/** DI token for the shared escalation log (wiring: RepositoryModule per driver). */
export const ESCALATION_LOG = Symbol('EscalationLog');

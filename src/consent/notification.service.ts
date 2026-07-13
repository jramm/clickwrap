/**
 * Delivery evidence from the portal (POST /customers/:id/notifications): "popup was displayed".
 * notifiedAt = server time (no backdating); displayedAt is only used for plausibility checks. The
 * deadline is idempotent (notifiedAt set once, on first access), but EVERY display is recorded as a
 * PAGE_ACCESSED audit event — the delivery-evidence NotificationEvent is still written only once.
 */
import { Inject, Injectable, Optional } from '@nestjs/common';
import type { CustomerContext } from '../common/auth/actor.js';
import type { Clock } from '../domain/clock.js';
import { DomainError } from '../common/errors.js';
import type {
  AgreementVersionRepo,
  CustomerVersionStateRepo,
  NotificationEventRepo,
} from '../domain/ports.js';
import { EventRecorder } from '../events/event-recorder.js';
import { recordAccess } from '../domain/state-machine.js';
import type { CustomerVersionStateValue } from '../domain/types.js';
import { TOKENS } from '../persistence/tokens.js';
import { CONSENT_TOKENS, type IdGenerator } from './ports.js';

/** Beyond this deviation displayedAt is considered implausible and is ignored (server time applies anyway). */
const PLAUSIBILITY_WINDOW_MS = 10 * 60 * 1000;

/**
 * Interactive display channels that count as provable access: the portal popup and the hosted
 * acceptance page (rendering the page IS the access proof). EMAIL delivery evidence goes through
 * the delivery-event pipeline, not this service.
 */
export type DisplayNotificationChannel = 'PORTAL' | 'LINK';

export interface NotificationInput {
  customerId: string;
  versionId: string;
  channel: DisplayNotificationChannel;
  displayedAt?: Date;
  context: CustomerContext;
}

export interface NotificationResponse {
  state: CustomerVersionStateValue;
  notifiedAt?: Date;
  deadlineAt?: Date;
}

@Injectable()
export class NotificationService {
  constructor(
    @Inject(TOKENS.AgreementVersionRepo) private readonly versions: AgreementVersionRepo,
    @Inject(TOKENS.CustomerVersionStateRepo) private readonly states: CustomerVersionStateRepo,
    @Inject(TOKENS.NotificationEventRepo) private readonly events: NotificationEventRepo,
    @Inject(CONSENT_TOKENS.IdGenerator) private readonly ids: IdGenerator,
    @Inject(TOKENS.Clock) private readonly clock: Clock,
    @Optional() private readonly recorder?: EventRecorder,
  ) {}

  async notify(input: NotificationInput): Promise<NotificationResponse> {
    const version = await this.versions.findById(input.versionId);
    if (!version) {
      throw new DomainError('VERSION_NOT_FOUND');
    }
    const state = await this.states.findByCustomerAndVersion(input.customerId, input.versionId);
    if (!state) {
      throw new DomainError('INVALID_STATE', `No rollout state for (${input.customerId}, ${input.versionId})`);
    }

    // Plausibility check: displayedAt is never used for deadline computation — only server time counts.
    this.assessPlausibility(input.displayedAt);

    const wasFirstAccess = state.notifiedAt === undefined;
    // Block carry-over: predecessor version was blocking → blocks immediately (deadlineAt = notifiedAt).
    const updated = recordAccess(state, this.clock, version, state.carryOverBlocking ?? false);

    // Atomic: SET notifiedAt=now() WHERE notifiedAt IS NULL AND state='PENDING_NOTIFICATION' —
    // the first delivery wins; a state that became SUPERSEDED/ACCEPTED in the meantime is never
    // revived.
    const saved = await this.states.setNotifiedAtomically(state.id, {
      state: updated.state,
      notifiedAt: updated.notifiedAt,
      deadlineAt: updated.deadlineAt,
    });

    // FIRST provable access is the delivery evidence that starts the deadline — recorded ONCE as a
    // NotificationEvent (also the reminder's recipient source). Only if the atomic write actually
    // applied (checked against saved, not our own snapshot): a delivery that hit a state superseded
    // in the meantime records nothing.
    if (wasFirstAccess && saved.notifiedAt !== undefined) {
      await this.events.append({
        id: this.ids.next('n'),
        customerVersionStateId: state.id,
        channel: input.channel,
        recipient: input.context.actor.userId,
        occurredAt: this.clock.now(),
      });
    }
    // EVERY display of the page/popup is recorded as a PAGE_ACCESSED audit event — not just the
    // first — so repeated displays are tracked in the event log. notifiedAt/deadlineAt stay
    // first-access-only (set atomically above); this is a pure audit trail and never shifts the
    // deadline. Skipped only when the access can't apply (e.g. superseded → saved.notifiedAt unset).
    if (saved.notifiedAt !== undefined) {
      await this.recorder?.record({
        type: 'PAGE_ACCESSED',
        category: 'ACCESS',
        actorKind: 'CUSTOMER',
        actorLabel: input.context.actor.name ?? input.context.actor.email ?? input.context.actor.userId,
        customerId: input.customerId,
        versionId: input.versionId,
        versionLabel: version.versionLabel,
        channel: input.channel,
        recipient: input.context.actor.userId,
        summary: `Acceptance page opened via ${input.channel} (version ${version.versionLabel})`,
      });
    }

    return { state: saved.state, notifiedAt: saved.notifiedAt, deadlineAt: saved.deadlineAt };
  }

  private assessPlausibility(displayedAt?: Date): boolean {
    if (displayedAt === undefined) {
      return true;
    }
    return Math.abs(this.clock.now().getTime() - displayedAt.getTime()) <= PLAUSIBILITY_WINDOW_MS;
  }
}

/**
 * Objection from the portal (POST /customers/:id/objections).
 * PASSIVE versions within the period only; after expiry only an escalation note + error.
 */
import { Inject, Injectable, Optional } from '@nestjs/common';
import type { CustomerContext } from '../common/auth/actor.js';
import type { Clock } from '../domain/clock.js';
import { DomainError } from '../common/errors.js';
import type { AgreementVersionRepo, CustomerVersionStateRepo, ObjectionRepo } from '../domain/ports.js';
import { object as objectState } from '../domain/state-machine.js';
import type { Objection } from '../domain/types.js';
import { EventRecorder } from '../events/event-recorder.js';
import { AdminNotificationService } from '../plugins/email/core/admin-notification.service.js';
import { ESCALATION_LOG, type EscalationLog } from '../common/escalation/escalation-log.js';
import { TOKENS } from '../persistence/tokens.js';
import { CONSENT_TOKENS, type IdempotencyStore, type IdGenerator } from './ports.js';

export interface ObjectionInput {
  customerId: string;
  versionId: string;
  reason?: string;
  idempotencyKey: string;
  context: CustomerContext;
}

export interface ObjectionResponse {
  objectionId: string;
  state: 'OBJECTED';
}

@Injectable()
export class ObjectionService {
  constructor(
    @Inject(TOKENS.AgreementVersionRepo) private readonly versions: AgreementVersionRepo,
    @Inject(TOKENS.CustomerVersionStateRepo) private readonly states: CustomerVersionStateRepo,
    @Inject(TOKENS.ObjectionRepo) private readonly objections: ObjectionRepo,
    @Inject(ESCALATION_LOG) private readonly escalations: EscalationLog,
    @Inject(CONSENT_TOKENS.IdempotencyStore) private readonly idempotency: IdempotencyStore,
    @Inject(CONSENT_TOKENS.IdGenerator) private readonly ids: IdGenerator,
    @Inject(TOKENS.Clock) private readonly clock: Clock,
    @Optional() private readonly recorder?: EventRecorder,
    @Optional() private readonly adminNotifications?: AdminNotificationService,
  ) {}

  async object(input: ObjectionInput): Promise<ObjectionResponse> {
    const idemKey = `objection:${input.customerId}:${input.idempotencyKey}`;
    const replay = await this.idempotency.get<ObjectionResponse>(idemKey);
    if (replay) {
      return replay;
    }

    const version = await this.versions.findById(input.versionId);
    if (!version) {
      throw new DomainError('VERSION_NOT_FOUND');
    }
    const state = await this.states.findByCustomerAndVersion(input.customerId, input.versionId);
    if (!state) {
      throw new DomainError('INVALID_STATE', `No rollout state for (${input.customerId}, ${input.versionId})`);
    }

    let objected;
    try {
      objected = objectState(state, version, this.clock);
    } catch (err) {
      // Period expired: the error propagates (422), but the escalation note is recorded.
      if (err instanceof DomainError && err.code === 'OBJECTION_PERIOD_EXPIRED') {
        await this.escalations.record({
          id: this.ids.next('esc'),
          kind: 'OBJECTION_AFTER_PERIOD',
          customerId: input.customerId,
          versionId: input.versionId,
          actor: input.context.actor,
          reason: input.reason,
          note: 'Objection received after the objection period expired (escalation note only).',
          occurredAt: this.clock.now(),
        });
      }
      throw err;
    }

    // Conditional transition ONLY from NOTIFIED: if the state was changed between
    // read and write (e.g. ACCEPTED or SUPERSEDED), NOTHING is overwritten and no objection is
    // recorded — the transition deliberately happens BEFORE the objection append (no orphaned entry).
    const transitioned = await this.states.transition(state.id, 'NOTIFIED', { state: objected.state });
    if (!transitioned) {
      const current = await this.states.findById(state.id);
      throw new DomainError(
        'INVALID_STATE',
        `CustomerVersionState ${state.id} was changed concurrently (now: ${current?.state ?? 'unknown'})`,
      );
    }

    const objection: Objection = {
      id: this.ids.next('o'),
      customerId: input.customerId,
      versionId: input.versionId,
      objectedAt: this.clock.now(),
      actor: input.context.actor,
      reason: input.reason,
      channel: 'PORTAL',
    };
    await this.objections.append(objection);

    await this.recorder?.record({
      type: 'OBJECTION_RAISED',
      category: 'CONSENT',
      actorKind: 'CUSTOMER',
      actorLabel: input.context.actor.name ?? input.context.actor.email ?? 'customer',
      customerId: input.customerId,
      versionId: input.versionId,
      versionLabel: version.versionLabel,
      channel: 'PORTAL',
      summary: `Objection raised against version ${version.versionLabel}${input.reason ? `: ${input.reason}` : ''}`,
      metadata: { ...(input.reason !== undefined ? { reason: input.reason } : {}) },
    });

    // Notify admins about the objection (Widerspruch) via the active admin-notification plugins
    // (e-mail/Slack/HubSpot). Best-effort and failure-isolated in the service — never blocks the
    // objection. Only fires on the first (non-replay) success, since replays return early above.
    await this.adminNotifications?.notify({
      event: 'OBJECTION_RAISED',
      title: `Objection raised against ${version.versionLabel}`,
      body: [
        'A customer raised an objection (Widerspruch).',
        `Customer: ${input.customerId}`,
        `Version: ${version.versionLabel} (${input.versionId})`,
        `Raised by: ${input.context.actor.name ?? input.context.actor.email ?? 'unknown'}`,
        `Reason: ${input.reason ?? '—'}`,
        `At: ${objection.objectedAt.toISOString()}`,
      ].join('\n'),
      customerId: input.customerId,
      customerName: input.context.actor.name,
      versionId: input.versionId,
      versionLabel: version.versionLabel,
      reason: input.reason,
      occurredAt: objection.objectedAt.toISOString(),
    });

    const response: ObjectionResponse = { objectionId: objection.id, state: 'OBJECTED' };
    await this.idempotency.put(idemKey, response);
    return response;
  }
}

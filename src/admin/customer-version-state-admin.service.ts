import { Inject, Injectable, Optional } from '@nestjs/common';
import { DomainError } from '../common/errors.js';
import { ADMIN_AUDIT_TOKEN, type AdminAuditRepo } from '../agreements/audit.js';
import { AGREEMENTS_TOKENS, type RolloutNotifier } from '../agreements/ports.js';
import { newId } from '../agreements/ids.js';
import { customerDisplayName } from '../domain/customer.js';
import { EventRecorder } from '../events/event-recorder.js';
import { TOKENS } from '../persistence/tokens.js';
import type { Clock } from '../domain/clock.js';
import type {
  AgreementVersionRepo,
  CustomerRepo,
  CustomerVersionStateRepo,
} from '../domain/ports.js';
import type { CustomerVersionState } from '../domain/types.js';

export interface PatchStateInput {
  /** New deadline (deadline extension). Required when suspending a block. */
  deadlineAt?: Date;
  /** Suspend the block: EXPIRED_BLOCKING → NOTIFIED with a new deadlineAt. */
  suspendBlock?: boolean;
  /**
   * Reopen an objection: OBJECTED → NOTIFIED so the customer sees the popup again and can
   * reconsider (accept or object anew). The append-only Objection evidence is kept untouched — the
   * trace that they initially objected is preserved.
   */
  reopenObjection?: boolean;
  /** Mandatory reason (audit). */
  reason: string;
}

/** Go-live/operations tooling: extend deadline / suspend block / send reminder. */
@Injectable()
export class CustomerVersionStateAdminService {
  constructor(
    @Inject(TOKENS.CustomerVersionStateRepo) private readonly states: CustomerVersionStateRepo,
    @Inject(TOKENS.AgreementVersionRepo) private readonly versions: AgreementVersionRepo,
    @Inject(TOKENS.CustomerRepo) private readonly customers: CustomerRepo,
    @Inject(AGREEMENTS_TOKENS.RolloutNotifier) private readonly notifier: RolloutNotifier,
    @Inject(ADMIN_AUDIT_TOKEN) private readonly audit: AdminAuditRepo,
    @Inject(TOKENS.Clock) private readonly clock: Clock,
    @Optional() private readonly recorder?: EventRecorder,
  ) {}

  async patch(stateId: string, input: PatchStateInput, adminUserId: string): Promise<CustomerVersionState> {
    if (!input.reason || input.reason.trim() === '') {
      throw new DomainError('INVALID_STATE', 'reason is required');
    }
    const state = await this.getState(stateId);

    let updated: CustomerVersionState;
    if (input.reopenObjection) {
      if (state.state !== 'OBJECTED') {
        throw new DomainError('INVALID_STATE', `Reopening is only allowed from OBJECTED, not from ${state.state}`);
      }
      // OBJECTED → NOTIFIED: the version becomes outstanding again (the customer sees the popup and
      // can accept or object anew); notifiedAt/deadlineAt are kept. The append-only Objection
      // evidence is deliberately NOT touched — the trace that the customer objected is preserved.
      updated = { ...state, state: 'NOTIFIED' };
    } else if (input.suspendBlock) {
      if (state.state !== 'EXPIRED_BLOCKING') {
        throw new DomainError('INVALID_STATE', `Block suspension is only allowed from EXPIRED_BLOCKING, not from ${state.state}`);
      }
      if (!input.deadlineAt) {
        throw new DomainError('INVALID_STATE', 'deadlineAt is required when suspending a block');
      }
      updated = { ...state, state: 'NOTIFIED', deadlineAt: input.deadlineAt };
    } else if (input.deadlineAt) {
      updated = { ...state, deadlineAt: input.deadlineAt };
    } else {
      throw new DomainError('INVALID_STATE', 'Neither a deadline extension, a block suspension nor an objection reopen was specified');
    }

    const saved = await this.states.save(updated);
    await this.audit.append({
      id: newId('audit'),
      action: 'CUSTOMER_VERSION_STATE_PATCH',
      actor: adminUserId,
      targetType: 'CustomerVersionState',
      targetId: stateId,
      reason: input.reason,
      metadata: {
        deadlineAt: input.deadlineAt,
        suspendBlock: input.suspendBlock === true,
        reopenObjection: input.reopenObjection === true,
      },
      createdAt: this.clock.now(),
    });

    const eventType = input.reopenObjection
      ? 'OBJECTION_REOPENED'
      : input.suspendBlock
        ? 'BLOCK_SUSPENDED'
        : 'DEADLINE_EXTENDED';
    const summaryLabel = input.reopenObjection
      ? 'Objection reset'
      : input.suspendBlock
        ? 'Block suspended'
        : 'Deadline extended';
    await this.recorder?.record({
      type: eventType,
      category: 'ADMINISTRATION',
      actorKind: 'ADMIN',
      actorLabel: adminUserId,
      customerId: saved.customerId,
      versionId: saved.versionId,
      summary: `${summaryLabel} — ${input.reason}`,
      metadata: {
        reason: input.reason,
        ...(input.deadlineAt !== undefined ? { deadlineAt: input.deadlineAt.toISOString() } : {}),
      },
    });
    return saved;
  }

  async remind(stateId: string, adminUserId: string): Promise<CustomerVersionState> {
    const state = await this.getState(stateId);
    const version = await this.versions.findById(state.versionId);
    if (!version) {
      throw new DomainError('VERSION_NOT_FOUND');
    }
    const customer = await this.customers.findById(state.customerId);
    if (!customer) {
      throw new DomainError('CUSTOMER_NOT_FOUND');
    }

    await this.notifier.remind(customer, state, version);
    const saved = await this.states.save({ ...state, remindersSent: state.remindersSent + 1 });
    await this.audit.append({
      id: newId('audit'),
      action: 'REMIND',
      actor: adminUserId,
      targetType: 'CustomerVersionState',
      targetId: stateId,
      createdAt: this.clock.now(),
    });

    await this.recorder?.record({
      type: 'REMINDER_TRIGGERED',
      category: 'ADMINISTRATION',
      actorKind: 'ADMIN',
      actorLabel: adminUserId,
      customerId: customer.id,
      customerName: customerDisplayName(customer),
      versionId: version.id,
      versionLabel: version.versionLabel,
      summary: 'Reminder e-mail re-sent',
    });
    return saved;
  }

  private async getState(stateId: string): Promise<CustomerVersionState> {
    const state = await this.states.findById(stateId);
    if (!state) {
      throw new DomainError('INVALID_STATE', `CustomerVersionState ${stateId} does not exist`);
    }
    return state;
  }
}

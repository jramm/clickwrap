import { Inject, Injectable } from '@nestjs/common';
import { DomainError } from '../common/errors';
import { ADMIN_AUDIT_TOKEN, type AdminAuditRepo } from '../agreements/audit';
import { AGREEMENTS_TOKENS, type RolloutNotifier } from '../agreements/ports';
import { newId } from '../agreements/ids';
import { TOKENS } from '../persistence/tokens';
import type { Clock } from '../domain/clock';
import type {
  AgreementVersionRepo,
  CustomerRepo,
  CustomerVersionStateRepo,
} from '../domain/ports';
import type { CustomerVersionState } from '../domain/types';

export interface PatchStateInput {
  /** New deadline (deadline extension). Required when suspending a block. */
  deadlineAt?: Date;
  /** Suspend the block: EXPIRED_BLOCKING → NOTIFIED with a new deadlineAt. */
  suspendBlock?: boolean;
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
  ) {}

  async patch(stateId: string, input: PatchStateInput, adminUserId: string): Promise<CustomerVersionState> {
    if (!input.reason || input.reason.trim() === '') {
      throw new DomainError('INVALID_STATE', 'reason is required');
    }
    const state = await this.getState(stateId);

    let updated: CustomerVersionState;
    if (input.suspendBlock) {
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
      throw new DomainError('INVALID_STATE', 'Neither a deadline extension nor a block suspension was specified');
    }

    const saved = await this.states.save(updated);
    await this.audit.append({
      id: newId('audit'),
      action: 'CUSTOMER_VERSION_STATE_PATCH',
      actor: adminUserId,
      targetType: 'CustomerVersionState',
      targetId: stateId,
      reason: input.reason,
      metadata: { deadlineAt: input.deadlineAt, suspendBlock: input.suspendBlock === true },
      createdAt: this.clock.now(),
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

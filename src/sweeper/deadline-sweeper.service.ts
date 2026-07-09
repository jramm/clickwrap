import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Clock } from '../domain/clock';
import { consentTextHashFor } from '../domain/consent-rules';
import type { AcceptanceRepo, AgreementVersionRepo, CustomerVersionStateRepo } from '../domain/ports';
import { sweep } from '../domain/state-machine';
import type { Acceptance, CustomerVersionState } from '../domain/types';
import { TOKENS } from '../persistence/tokens';
import { EventRecorder } from '../events/event-recorder';
import { AcceptanceConfirmationService } from '../plugins/email/core/acceptance-confirmation.service';
import { SWEEPER_SYSTEM_ACTOR } from './system-actor';

/** Kill switch: SWEEPER_ENABLED=false disables the sweeper entirely (a full no-op). */
const isSweeperEnabled = (): boolean => process.env.SWEEPER_ENABLED !== 'false';

/**
 * Deadline sweeper (runs hourly here, though the spec calls for a daily run):
 * PASSIVE + deadline reached → Acceptance(method=TACIT, channel=SYSTEM) + state ACCEPTED.
 * ACTIVE + absolute hard deadline reached → state EXPIRED_BLOCKING, for both NOTIFIED and
 * never-accessed PENDING_NOTIFICATION customers. Everything else (especially SUPERSEDED) is left
 * untouched — the transition logic itself decides in `state-machine.sweep()`, never the caller.
 */
@Injectable()
export class DeadlineSweeperService {
  private readonly logger = new Logger(DeadlineSweeperService.name);

  constructor(
    @Inject(TOKENS.CustomerVersionStateRepo) private readonly stateRepo: CustomerVersionStateRepo,
    @Inject(TOKENS.AgreementVersionRepo) private readonly versionRepo: AgreementVersionRepo,
    @Inject(TOKENS.AcceptanceRepo) private readonly acceptanceRepo: AcceptanceRepo,
    @Inject(TOKENS.Clock) private readonly clock: Clock,
    @Optional() private readonly confirmation?: AcceptanceConfirmationService,
    @Optional() private readonly recorder?: EventRecorder,
  ) {}

  /** Sweep run: finds due states and applies the matching transition logic per version. */
  async run(): Promise<void> {
    if (!isSweeperEnabled()) {
      return;
    }
    const dueStates = await this.stateRepo.findDueForSweep(this.clock.now());
    for (const state of dueStates) {
      // A failing entry does NOT abort the run — the remaining customers are still processed;
      // the failed one stays NOTIFIED and becomes due again on the next run.
      try {
        await this.sweepOne(state);
      } catch (err) {
        this.logger.error(`Sweep failed for CustomerVersionState ${state.id}`, err instanceof Error ? err.stack : String(err));
      }
    }
  }

  private async sweepOne(state: CustomerVersionState): Promise<void> {
    const version = await this.versionRepo.findById(state.versionId);
    if (!version) {
      return;
    }
    const result = sweep(state, version, this.clock);
    if (result.outcome === 'NOOP') {
      // In particular SUPERSEDED: never record a TACIT acceptance for a superseded version.
      return;
    }
    // Conditional transition from the OBSERVED state (PENDING_NOTIFICATION for a never-accessed
    // ACTIVE customer, NOTIFIED otherwise): if the state changed between findDue and processing
    // (e.g. an active acceptance → ACCEPTED, or a publish → SUPERSEDED), the UPDATE has no effect
    // — and then NO event may be recorded either. The transition is therefore deliberately placed
    // BEFORE the acceptance append / event emission.
    const transitioned = await this.stateRepo.transition(state.id, state.state, { state: result.state.state });
    if (!transitioned) {
      // NOOP / already-changed / SUPERSEDED: NEITHER a DEADLINE_EXPIRED nor a TACIT acceptance
      // event is emitted — the automatic transition did not actually apply.
      return;
    }
    if (result.outcome === 'TACIT_ACCEPTED') {
      const acceptance: Acceptance = {
        id: randomUUID(),
        customerId: state.customerId,
        versionId: state.versionId,
        method: 'TACIT',
        channel: 'SYSTEM',
        acceptedAt: this.clock.now(),
        actor: SWEEPER_SYSTEM_ACTOR,
        isEffective: true,
        consentText: version.consentText,
        consentTextHash: version.consentText !== undefined ? consentTextHashFor(version) : undefined,
        contentHash: version.contentHash,
      };
      await this.acceptanceRepo.append(acceptance);
      // Passive/TACIT acceptance is a SEPARATE path from the interactive AcceptanceService — it gets
      // its own VERSION_ACCEPTED record (SYSTEM, method=TACIT). documentType/versionLabel are
      // resolved centrally by the EventRecorder from versionId.
      await this.recorder?.record({
        type: 'VERSION_ACCEPTED',
        category: 'CONSENT',
        actorKind: 'SYSTEM',
        actorLabel: SWEEPER_SYSTEM_ACTOR.userId,
        customerId: state.customerId,
        versionId: state.versionId,
        versionLabel: version.versionLabel,
        channel: 'SYSTEM',
        summary: 'Passively accepted (objection period lapsed)',
        metadata: { method: 'TACIT' },
      });
      // Best-effort acceptance confirmation (delivers the accepted PDF); never fails the sweep.
      await this.confirmation?.sendForAcceptance(version, acceptance);
    } else if (result.outcome === 'EXPIRED_BLOCKING') {
      await this.recorder?.record({
        type: 'DEADLINE_EXPIRED',
        category: 'CONSENT',
        actorKind: 'SYSTEM',
        actorLabel: SWEEPER_SYSTEM_ACTOR.userId,
        customerId: state.customerId,
        versionId: state.versionId,
        versionLabel: version.versionLabel,
        summary: 'Deadline expired — became blocking',
      });
    }
  }
}

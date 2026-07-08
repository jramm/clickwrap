import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Clock } from '../domain/clock';
import type { AgreementDocumentRepo, AgreementVersionRepo, CustomerVersionStateRepo } from '../domain/ports';
import { supersede } from '../domain/state-machine';
import type { AgreementDocument, AgreementVersion } from '../domain/types';
import { TOKENS } from '../persistence/tokens';
import { newId } from '../agreements/ids';

/** Kill switch: SWEEPER_ENABLED=false disables the sweeper entirely (a full no-op). */
const isSweeperEnabled = (): boolean => process.env.SWEEPER_ENABLED !== 'false';

/**
 * Activation sweeper — the deferred half of a scheduled publish (validFrom in the future).
 * Runs on the same cadence as the deadline sweeper (and deliberately BEFORE it, see
 * DeadlineSweeperJob): for each (type, audience) where a newer published version has become
 * effective (findCurrentPublished flipped to it at validFrom), it
 *
 *  1. retires the predecessor PUBLISHED versions (validFrom <= now, not the current one),
 *  2. supersedes their open CustomerVersionStates (SUPERSEDED — never TACIT afterwards),
 *  3. carries an EXPIRED_BLOCKING predecessor block over to the customer's state for the
 *     now-effective version (carryOverBlocking=true → blocks immediately via isBlocking) —
 *     exactly what PublishService does inline for an immediately effective publish.
 *
 * Idempotent (a retired predecessor is never matched again); per-document error isolation like
 * the other sweeps — a failing entry is logged and retried on the next run.
 */
@Injectable()
export class ActivationSweeperService {
  private readonly logger = new Logger(ActivationSweeperService.name);

  constructor(
    @Inject(TOKENS.AgreementDocumentRepo) private readonly documents: AgreementDocumentRepo,
    @Inject(TOKENS.AgreementVersionRepo) private readonly versions: AgreementVersionRepo,
    @Inject(TOKENS.CustomerVersionStateRepo) private readonly states: CustomerVersionStateRepo,
    @Inject(TOKENS.Clock) private readonly clock: Clock,
  ) {}

  /** Activation run: flips every (type, audience) whose scheduled version has become effective. */
  async run(): Promise<void> {
    if (!isSweeperEnabled()) {
      return;
    }
    for (const document of await this.documents.findAll()) {
      // A failing entry does NOT abort the run — the remaining documents are still processed;
      // the failed one is picked up again on the next run (the flip stays pending, idempotent).
      try {
        await this.activateOne(document);
      } catch (err) {
        this.logger.error(
          `Activation sweep failed for document ${document.id} (${document.type}, ${document.audience})`,
          err instanceof Error ? err.stack : String(err),
        );
      }
    }
  }

  private async activateOne(document: AgreementDocument): Promise<void> {
    const now = this.clock.now();
    const current = await this.versions.findCurrentPublished(document.type, document.audience, now);
    if (!current) {
      return;
    }
    const siblings = await this.versions.findByDocument(document.id);
    // Predecessors = other PUBLISHED versions that are already in effect (validFrom <= now).
    // Upcoming versions (validFrom > now) are left untouched — their flip has not happened yet.
    const predecessors = siblings.filter(
      (v) => v.id !== current.id && v.status === 'PUBLISHED' && v.validFrom.getTime() <= now.getTime(),
    );
    for (const predecessor of predecessors) {
      await this.versions.save({ ...predecessor, status: 'RETIRED' });
      const openStates = await this.states.findOpenByVersion(predecessor.id);
      for (const openState of openStates) {
        const { state: superseded, wasBlocking } = supersede(openState);
        await this.states.save(superseded);
        if (wasBlocking) {
          await this.carryBlockOver(openState.customerId, current);
        }
      }
    }
  }

  /**
   * Continues an EXPIRED_BLOCKING predecessor block on the successor state (no new grace
   * period). Terminal successor states (ACCEPTED in advance / OBJECTED / SUPERSEDED) are never
   * touched; a missing rollout state is created defensively so the block never silently
   * disappears.
   */
  private async carryBlockOver(customerId: string, current: AgreementVersion): Promise<void> {
    const successor = await this.states.findByCustomerAndVersion(customerId, current.id);
    if (!successor) {
      await this.states.save({
        id: newId('cvs'),
        customerId,
        versionId: current.id,
        state: 'PENDING_NOTIFICATION',
        remindersSent: 0,
        carryOverBlocking: true,
      });
      return;
    }
    const isOpenForCarryOver = successor.state === 'PENDING_NOTIFICATION' || successor.state === 'NOTIFIED';
    if (isOpenForCarryOver && successor.carryOverBlocking !== true) {
      await this.states.save({ ...successor, carryOverBlocking: true });
    }
  }
}

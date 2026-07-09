import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { Clock } from '../domain/clock';
import type { AgreementDocumentRepo, AgreementVersionRepo, CustomerVersionStateRepo } from '../domain/ports';
import { rolloutDeadlineFor, supersede } from '../domain/state-machine';
import type { AgreementDocument, AgreementVersion } from '../domain/types';
import { EventRecorder } from '../events/event-recorder';
import { TOKENS } from '../persistence/tokens';
import { newId } from '../agreements/ids';

/** Actor id for automatic (cron) activation-sweeper transitions. */
const ACTIVATION_SWEEPER_ACTOR = 'system:activation-sweeper';

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
    @Optional() private readonly recorder?: EventRecorder,
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
    if (predecessors.length === 0) {
      // No predecessor in effect → nothing flipped in this run (idempotent re-check). Do NOT emit
      // VERSION_ACTIVATED: the version became effective at its own publish, not via this sweep.
      return;
    }
    // A scheduled version became the effective one (its predecessors are now being retired).
    await this.recorder?.record({
      type: 'VERSION_ACTIVATED',
      category: 'ADMINISTRATION',
      actorKind: 'SYSTEM',
      actorLabel: ACTIVATION_SWEEPER_ACTOR,
      versionId: current.id,
      documentType: document.type,
      audience: document.audience,
      versionLabel: current.versionLabel,
      summary: `Version ${current.versionLabel} activated (scheduled publish became effective)`,
    });
    for (const predecessor of predecessors) {
      await this.versions.save({ ...predecessor, status: 'RETIRED' });
      await this.recorder?.record({
        type: 'VERSION_RETIRED',
        category: 'ADMINISTRATION',
        actorKind: 'SYSTEM',
        actorLabel: ACTIVATION_SWEEPER_ACTOR,
        versionId: predecessor.id,
        documentType: document.type,
        audience: document.audience,
        versionLabel: predecessor.versionLabel,
        summary: `Version ${predecessor.versionLabel} retired`,
      });
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
        // ACTIVE: absolute hard deadline stamped at rollout; PASSIVE: undefined (starts at access).
        deadlineAt: rolloutDeadlineFor(current),
        remindersSent: 0,
        carryOverBlocking: true,
      });
      // A brand-new PENDING_NOTIFICATION obligation was created for this customer/version — the
      // authoritative "put under obligation" record (SYSTEM, defensive block-preserving creation).
      await this.recorder?.record({
        type: 'OBLIGATION_ROLLED_OUT',
        category: 'CONSENT',
        actorKind: 'SYSTEM',
        actorLabel: ACTIVATION_SWEEPER_ACTOR,
        customerId,
        versionId: current.id,
        versionLabel: current.versionLabel,
        summary: `Customer put under obligation for version ${current.versionLabel}`,
      });
      await this.recordBlockCarriedOver(customerId, current);
      return;
    }
    const isOpenForCarryOver = successor.state === 'PENDING_NOTIFICATION' || successor.state === 'NOTIFIED';
    if (isOpenForCarryOver && successor.carryOverBlocking !== true) {
      await this.states.save({ ...successor, carryOverBlocking: true });
      await this.recordBlockCarriedOver(customerId, current);
    }
  }

  private async recordBlockCarriedOver(customerId: string, current: AgreementVersion): Promise<void> {
    await this.recorder?.record({
      type: 'BLOCK_CARRIED_OVER',
      category: 'CONSENT',
      actorKind: 'SYSTEM',
      actorLabel: ACTIVATION_SWEEPER_ACTOR,
      customerId,
      versionId: current.id,
      versionLabel: current.versionLabel,
      summary: 'Predecessor block carried over',
    });
  }
}

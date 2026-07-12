import { Inject, Injectable, Logger } from '@nestjs/common';
import type { RolloutNotifier } from '../agreements/ports.js';
import type { AgreementVersionRepo, CustomerRepo, CustomerVersionStateRepo } from '../domain/ports.js';
import type { AgreementVersion } from '../domain/types.js';
import { AgreementRolloutNotifier } from '../plugins/email/core/agreement-rollout-notifier.js';
import { TOKENS } from '../persistence/tokens.js';

/** Default number of pending notifications processed per run — one publish of ~any size drains fast. */
const DEFAULT_BATCH = 200;

/**
 * Sends the publish-rollout e-mails asynchronously, off the publish request (which now only marks
 * each rollout state `notificationDueAt`). This is what keeps publishing to many customers fast: no
 * e-mail I/O happens on the publish path.
 *
 * Idempotency + retry via the state's `notificationDueAt`:
 *  - a successful send clears it (including a customer with no contacts — that's a no-op send, and
 *    the state correctly stays PENDING_NOTIFICATION and shows up in the "not reachable" report);
 *  - a send that throws leaves it set → retried on the next run (per-candidate failure isolation, so
 *    one bad send never stalls the batch);
 *  - it never touches `state`, so a customer who accepts between marking and sending is not clobbered
 *    (the candidate query only returns states that are still PENDING_NOTIFICATION).
 */
@Injectable()
export class RolloutNotificationService {
  private readonly logger = new Logger(RolloutNotificationService.name);

  constructor(
    @Inject(TOKENS.CustomerVersionStateRepo) private readonly states: CustomerVersionStateRepo,
    @Inject(TOKENS.CustomerRepo) private readonly customers: CustomerRepo,
    @Inject(TOKENS.AgreementVersionRepo) private readonly versions: AgreementVersionRepo,
    // The concrete AgreementRolloutNotifier (from the @Global EmailModule) is the injection token;
    // typed as the RolloutNotifier port so tests can pass the in-memory fake.
    @Inject(AgreementRolloutNotifier) private readonly notifier: RolloutNotifier,
  ) {}

  async run(batchSize: number = DEFAULT_BATCH): Promise<void> {
    const due = await this.states.findDueForNotification(batchSize);
    // A rollout is one version, so all candidates in a batch typically share it — cache the lookup.
    const versionCache = new Map<string, AgreementVersion | undefined>();
    for (const state of due) {
      try {
        if (!versionCache.has(state.versionId)) {
          versionCache.set(state.versionId, await this.versions.findById(state.versionId));
        }
        const version = versionCache.get(state.versionId);
        const customer = await this.customers.findById(state.customerId);
        // Orphaned marker (version/customer gone, or customer soft-deleted): nothing to send — clear
        // it so the batch isn't blocked by a candidate that can never succeed.
        if (!version || !customer || customer.deletedAt !== undefined) {
          await this.states.clearNotificationDue(state.id);
          continue;
        }
        await this.notifier.notifyVersionPublished(customer, version);
        await this.states.clearNotificationDue(state.id);
      } catch (error) {
        // Leave notificationDueAt set → retried next run.
        this.logger.warn(
          `rollout notification failed for state ${state.id} (customer ${state.customerId}, version ${state.versionId}): ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }
}

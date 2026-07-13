import { Inject, Injectable, Logger } from '@nestjs/common';
import type { RolloutNotifier } from '../agreements/ports.js';
import type { AgreementVersionRepo, CustomerRepo, CustomerVersionStateRepo } from '../domain/ports.js';
import type { AgreementVersion } from '../domain/types.js';
import { AgreementRolloutNotifier } from '../plugins/email/core/agreement-rollout-notifier.js';
import { TOKENS } from '../persistence/tokens.js';

/** Number of pending notifications processed per run (paces bursts; the cron drains the rest). */
const DEFAULT_BATCH = 100;

/**
 * Sends the publish-rollout e-mails asynchronously, off the publish request (which only marks each
 * rollout state `notificationDueAt`). Keeps publishing to many customers fast: no e-mail I/O on the
 * publish path.
 *
 * AT-MOST-ONCE (crash-safe). Each due state's `notificationDueAt` marker is CLEARED *before* the
 * e-mail is sent, so a crash/restart mid-run, an OOM, or a partial per-contact failure can NEVER
 * re-send it. A rollout notification is best-effort — the hosted acceptance popup and the reminder
 * job still reach the customer, and the deadline logic is unaffected — so a rare missed e-mail is
 * strictly preferable to duplicate floods. (This deliberately replaced the earlier "send, then clear
 * on success" which was at-least-once: a crash between send and clear re-sent on every restart.)
 *
 * Kill switch: `ROLLOUT_NOTIFICATIONS_DISABLED=true` makes a run a no-op WITHOUT clearing markers, so
 * the backlog goes out once re-enabled — an operational off-switch for incidents.
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
    if (process.env.ROLLOUT_NOTIFICATIONS_DISABLED === 'true') {
      this.logger.warn('rollout notifications disabled (ROLLOUT_NOTIFICATIONS_DISABLED=true) — skipping run');
      return;
    }

    const due = await this.states.findDueForNotification(batchSize);
    // A rollout is one version, so all candidates in a batch typically share it — cache the lookup.
    const versionCache = new Map<string, AgreementVersion | undefined>();
    for (const state of due) {
      // CLAIM BEFORE SENDING (at-most-once): the durable clear commits here, so a crash/restart or a
      // partial failure after this point can never re-send this state. See the class doc.
      await this.states.clearNotificationDue(state.id);
      try {
        if (!versionCache.has(state.versionId)) {
          versionCache.set(state.versionId, await this.versions.findById(state.versionId));
        }
        const version = versionCache.get(state.versionId);
        const customer = await this.customers.findById(state.customerId);
        // Orphan / soft-deleted customer: already claimed above, nothing to send.
        if (!version || !customer || customer.deletedAt !== undefined) {
          continue;
        }
        await this.notifier.notifyVersionPublished(customer, version);
      } catch (error) {
        // Already claimed → NOT retried. Logged; the popup + reminder job still reach the customer.
        this.logger.warn(
          `rollout notification failed for state ${state.id} (customer ${state.customerId}, version ${state.versionId}) — not retried: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }
}

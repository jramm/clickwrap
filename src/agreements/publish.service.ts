import { Inject, Injectable, Optional } from '@nestjs/common';
import { EventRecorder } from '../events/event-recorder';
import { DomainError } from '../common/errors';
import { validateForPublish } from '../domain/consent-rules';
import { customerDisplayName } from '../domain/customer';
import { rolloutDeadlineFor, supersede } from '../domain/state-machine';
import { TOKENS } from '../persistence/tokens';
import type { Clock } from '../domain/clock';
import type {
  AgreementDocumentRepo,
  AgreementVersionRepo,
  CustomerRepo,
  CustomerVersionStateRepo,
} from '../domain/ports';
import type { CustomerVersionState } from '../domain/types';
import { ADMIN_AUDIT_TOKEN, type AdminAuditRepo } from './audit';
import { AGREEMENTS_TOKENS, type RolloutNotifier } from './ports';
import { newId } from './ids';

export interface PublishResult {
  versionId: string;
  status: 'PUBLISHED';
  rolloutCustomers: number;
  publishedAt: Date;
}

/**
 * Publish (core piece):
 *  1. validateForPublish (changeSummary required, consentText for ACTIVE, objectionPeriodDays for PASSIVE)
 *  2. version → PUBLISHED (publishedAt/By)
 *  3. previous PUBLISHED version of the same document → RETIRED
 *  4. all open CustomerVersionStates of the predecessor version → supersede() (returns wasBlocking)
 *  5. rollout: new PENDING_NOTIFICATION state per customer with a matching role;
 *     carryOverBlocking=true when the predecessor state was EXPIRED_BLOCKING
 *  6. e-mail delivery via RolloutNotifier; audit log (PUBLISH)
 *
 * Scheduled effectiveness (validFrom in the future): steps 3+4 are DEFERRED — the predecessor
 * stays PUBLISHED (it remains the compliance baseline until the flip at validFrom) and its open
 * states are not superseded yet. The rollout (step 5) still happens immediately so acceptance can
 * be collected in advance; block carry-over is applied at the flip by the activation sweeper
 * (src/sweeper/activation-sweeper.service.ts), not here.
 */
@Injectable()
export class PublishService {
  constructor(
    @Inject(TOKENS.AgreementVersionRepo) private readonly versions: AgreementVersionRepo,
    @Inject(TOKENS.AgreementDocumentRepo) private readonly documents: AgreementDocumentRepo,
    @Inject(TOKENS.CustomerRepo) private readonly customers: CustomerRepo,
    @Inject(TOKENS.CustomerVersionStateRepo) private readonly states: CustomerVersionStateRepo,
    @Inject(AGREEMENTS_TOKENS.RolloutNotifier) private readonly notifier: RolloutNotifier,
    @Inject(ADMIN_AUDIT_TOKEN) private readonly audit: AdminAuditRepo,
    @Inject(TOKENS.Clock) private readonly clock: Clock,
    @Optional() private readonly recorder?: EventRecorder,
  ) {}

  async publish(versionId: string, adminUserId: string): Promise<PublishResult> {
    const version = await this.versions.findById(versionId);
    if (!version) {
      throw new DomainError('VERSION_NOT_FOUND');
    }
    validateForPublish(version);

    const document = await this.documents.findById(version.documentId);
    if (!document) {
      throw new DomainError('INVALID_STATE', `Document ${version.documentId} does not exist`);
    }

    const publishedAt = this.clock.now();
    const effectiveImmediately = version.validFrom.getTime() <= publishedAt.getTime();
    const published = await this.versions.save({
      ...version,
      status: 'PUBLISHED',
      publishedAt,
      publishedBy: adminUserId,
    });

    // Predecessor PUBLISHED versions of the same document → RETIRED; their open states → SUPERSEDED.
    // Scheduled publish (validFrom in the future): SKIPPED — the predecessor remains the
    // compliance baseline until the flip; the activation sweeper retires it at validFrom.
    const blockingByCustomer = new Map<string, boolean>();
    if (effectiveImmediately) {
      const siblings = await this.versions.findByDocument(document.id);
      const predecessors = siblings.filter((v) => v.id !== version.id && v.status === 'PUBLISHED');
      for (const predecessor of predecessors) {
        await this.versions.save({ ...predecessor, status: 'RETIRED' });
        await this.recorder?.record({
          type: 'VERSION_RETIRED',
          category: 'ADMINISTRATION',
          actorKind: 'ADMIN',
          actorLabel: adminUserId,
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
            blockingByCustomer.set(openState.customerId, true);
          }
        }
      }
    }

    // Rollout only targets customers with a matching role.
    const targets = await this.customers.findByRole(document.audience);
    for (const customer of targets) {
      const carryOverBlocking = blockingByCustomer.get(customer.id) === true;
      const state: CustomerVersionState = {
        id: newId('cvs'),
        customerId: customer.id,
        versionId: version.id,
        state: 'PENDING_NOTIFICATION',
        // ACTIVE: stamp the absolute hard deadline immediately (blocks even never-accessed
        // customers at that date). PASSIVE: undefined — the objection period starts at access.
        deadlineAt: rolloutDeadlineFor(version),
        remindersSent: 0,
        carryOverBlocking: carryOverBlocking ? true : undefined,
      };
      await this.states.save(state);
      // Authoritative "customer put under obligation" record — crucial for customers without a
      // contact e-mail (no EMAIL_SENT fires for them). One per created PENDING_NOTIFICATION state.
      await this.recorder?.record({
        type: 'OBLIGATION_ROLLED_OUT',
        category: 'CONSENT',
        actorKind: 'ADMIN',
        actorLabel: adminUserId,
        customerId: customer.id,
        customerName: customerDisplayName(customer),
        versionId: version.id,
        documentType: document.type,
        audience: document.audience,
        versionLabel: version.versionLabel,
        summary: `Customer put under obligation for version ${version.versionLabel}`,
      });
      await this.notifier.notifyVersionPublished(customer, published);
    }

    await this.audit.append({
      id: newId('audit'),
      action: 'PUBLISH',
      actor: adminUserId,
      targetType: 'AgreementVersion',
      targetId: version.id,
      metadata: { documentId: document.id, rolloutCustomers: targets.length },
      createdAt: publishedAt,
    });

    await this.recorder?.record({
      type: 'VERSION_PUBLISHED',
      category: 'ADMINISTRATION',
      actorKind: 'ADMIN',
      actorLabel: adminUserId,
      versionId: version.id,
      documentType: document.type,
      audience: document.audience,
      versionLabel: version.versionLabel,
      summary: `Version ${version.versionLabel} published`,
      metadata: { documentId: document.id, rolloutCustomers: targets.length },
    });

    return { versionId: version.id, status: 'PUBLISHED', rolloutCustomers: targets.length, publishedAt };
  }
}

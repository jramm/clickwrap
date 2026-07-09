import { Inject, Injectable, Optional } from '@nestjs/common';
import { DomainError } from '../common/errors';
import { AcceptanceConfirmationService } from '../plugins/email/core/acceptance-confirmation.service';
import { ADMIN_AUDIT_TOKEN, type AdminAuditRepo } from '../agreements/audit';
import { AGREEMENTS_TOKENS, type PdfStorage, type PdfUpload } from '../agreements/ports';
import { newId } from '../agreements/ids';
import {
  assertCustomerHasRole,
  assertMethodChannelAllowed,
  consentTextHashFor,
} from '../domain/consent-rules';
import { accept } from '../domain/state-machine';
import { customerDisplayName } from '../domain/customer';
import { EventRecorder } from '../events/event-recorder';
import { TOKENS } from '../persistence/tokens';
import type { Actor } from '../common/auth/actor';
import type { Clock } from '../domain/clock';
import type {
  AcceptanceRepo,
  AgreementDocumentRepo,
  AgreementVersionRepo,
  CustomerRepo,
  CustomerVersionStateRepo,
} from '../domain/ports';
import type { Acceptance, CustomerVersionState } from '../domain/types';

export interface ManualAcceptanceInput {
  versionId: string;
  /** Manual admin recording: ACTIVE_CONSENT (e.g. by letter) or IMPORT. TACIT is excluded. */
  method: 'ACTIVE_CONSENT' | 'IMPORT';
  reason: string;
  evidenceDocument: PdfUpload;
}

export interface ManualAcceptanceResult {
  acceptanceId: string;
  state: CustomerVersionState['state'];
}

/**
 * Manual retroactive recording: channel=ADMIN, actor = admin user,
 * reason + evidenceDocument required; create/accept the state if needed (also from
 * PENDING_NOTIFICATION — letter case).
 */
@Injectable()
export class ManualAcceptanceService {
  constructor(
    @Inject(TOKENS.CustomerRepo) private readonly customers: CustomerRepo,
    @Inject(TOKENS.AgreementVersionRepo) private readonly versions: AgreementVersionRepo,
    @Inject(TOKENS.AgreementDocumentRepo) private readonly documents: AgreementDocumentRepo,
    @Inject(TOKENS.CustomerVersionStateRepo) private readonly states: CustomerVersionStateRepo,
    @Inject(TOKENS.AcceptanceRepo) private readonly acceptances: AcceptanceRepo,
    @Inject(AGREEMENTS_TOKENS.PdfStorage) private readonly pdf: PdfStorage,
    @Inject(ADMIN_AUDIT_TOKEN) private readonly audit: AdminAuditRepo,
    @Inject(TOKENS.Clock) private readonly clock: Clock,
    @Optional() private readonly confirmation?: AcceptanceConfirmationService,
    @Optional() private readonly recorder?: EventRecorder,
  ) {}

  async record(customerId: string, input: ManualAcceptanceInput, adminActor: Actor): Promise<ManualAcceptanceResult> {
    if (!input.reason || input.reason.trim() === '') {
      throw new DomainError('INVALID_STATE', 'reason is required');
    }
    // An empty upload (a missing/empty base64 string in the controller yields a
    // 0-byte buffer) is NO evidence — mandatory check for actual content.
    if (!input.evidenceDocument || input.evidenceDocument.buffer.length === 0) {
      throw new DomainError('INVALID_STATE', 'evidenceDocument is required');
    }
    // consent-rules matrix: ACTIVE_CONSENT/IMPORT × ADMIN are allowed, TACIT is not.
    assertMethodChannelAllowed(input.method, 'ADMIN');

    const customer = await this.customers.findById(customerId);
    if (!customer) {
      throw new DomainError('CUSTOMER_NOT_FOUND');
    }
    const version = await this.versions.findById(input.versionId);
    if (!version) {
      throw new DomainError('VERSION_NOT_FOUND');
    }
    const document = await this.documents.findById(version.documentId);
    if (!document) {
      throw new DomainError('INVALID_STATE', `Document ${version.documentId} does not exist`);
    }
    // Only documents of an audience whose role the customer has.
    assertCustomerHasRole(customer, document.audience);

    const stored = await this.pdf.store(input.evidenceDocument);

    // Create the state if needed (letter case: no delivery/state exists yet) and accept.
    let state = await this.states.findByCustomerAndVersion(customerId, version.id);
    if (!state) {
      state = await this.states.save({
        id: newId('cvs'),
        customerId,
        versionId: version.id,
        state: 'PENDING_NOTIFICATION',
        remindersSent: 0,
      });
    }
    const accepted = accept(state, input.method);
    // Conditional transition on the state as read: if the state was changed
    // concurrently (publish→SUPERSEDED, portal consent→ACCEPTED), nothing is overwritten;
    // the transition deliberately happens BEFORE the acceptance append (no orphaned evidence).
    const transitioned = await this.states.transition(state.id, state.state, { state: accepted.state });
    if (!transitioned) {
      const current = await this.states.findById(state.id);
      if (current?.state === 'ACCEPTED') {
        throw new DomainError('ALREADY_ACCEPTED');
      }
      throw new DomainError(
        'INVALID_STATE',
        `CustomerVersionState ${state.id} was changed concurrently (now: ${current?.state ?? 'unknown'})`,
      );
    }

    const acceptance: Acceptance = {
      id: newId('a'),
      customerId,
      versionId: version.id,
      method: input.method,
      channel: 'ADMIN',
      acceptedAt: this.clock.now(),
      actor: adminActor,
      isEffective: true,
      contentHash: version.contentHash,
      consentText: input.method === 'ACTIVE_CONSENT' ? version.consentText : undefined,
      consentTextHash:
        input.method === 'ACTIVE_CONSENT' && version.consentText !== undefined
          ? consentTextHashFor(version)
          : undefined,
    };
    const saved = await this.acceptances.append(acceptance);

    await this.audit.append({
      id: newId('audit'),
      action: 'MANUAL_ACCEPTANCE',
      actor: adminActor.userId,
      targetType: 'Acceptance',
      targetId: saved.id,
      reason: input.reason,
      metadata: { customerId, versionId: version.id, method: input.method, evidenceStorageKey: stored.storageKey },
      createdAt: this.clock.now(),
    });

    // Admin-triggered manual recording → MANUAL_ACCEPTANCE (the clearer mapping: it is an admin action,
    // distinct from a customer's own VERSION_ACCEPTED); method/channel carried in metadata. CONSENT.
    await this.recorder?.record({
      type: 'MANUAL_ACCEPTANCE',
      category: 'CONSENT',
      actorKind: 'ADMIN',
      actorLabel: adminActor.userId,
      customerId,
      customerName: customerDisplayName(customer),
      versionId: version.id,
      documentType: document.type,
      audience: document.audience,
      versionLabel: version.versionLabel,
      channel: 'ADMIN',
      summary: `Manual acceptance recorded for version ${version.versionLabel} — ${input.reason}`,
      metadata: { method: input.method, reason: input.reason },
    });

    // Best-effort acceptance confirmation (skips IMPORT internally); never fails the recording.
    await this.confirmation?.sendForAcceptance(version, acceptance);

    return { acceptanceId: saved.id, state: accepted.state };
  }
}

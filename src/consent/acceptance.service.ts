/**
 * Active consent from the portal popup (POST /customers/:id/acceptances).
 * Evidence chain is built server-side; actor/IP/UA come exclusively from the CustomerContext.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { CustomerContext } from '../common/auth/actor';
import { Clock } from '../domain/clock';
import {
  assertCustomerHasRole,
  assertDisplayedConsentTextMatches,
  assertMethodChannelAllowed,
  assertVersionCurrent,
  consentTextHashFor,
} from '../domain/consent-rules';
import { DomainError } from '../common/errors';
import type {
  AcceptanceRepo,
  AgreementDocumentRepo,
  AgreementVersionRepo,
  CustomerRepo,
  CustomerVersionStateRepo,
} from '../domain/ports';
import { accept } from '../domain/state-machine';
import type { Acceptance, CustomerVersionState } from '../domain/types';
import { TOKENS } from '../persistence/tokens';
import { CONSENT_TOKENS, type IdempotencyStore, type IdGenerator } from './ports';

/**
 * Interactive channels that may record ACTIVE_CONSENT through this service: the portal popup
 * and the hosted acceptance page (link token = auth, self-declared signer). ADMIN recordings go
 * through ManualAcceptanceService, TACIT only ever through the sweeper.
 */
export type InteractiveAcceptanceChannel = 'PORTAL' | 'LINK';

export interface AcceptanceInput {
  customerId: string;
  versionId: string;
  displayedConsentText: string;
  idempotencyKey: string;
  context: CustomerContext;
  /** Default PORTAL (popup); LINK = hosted acceptance page. */
  channel?: InteractiveAcceptanceChannel;
  /** LINK only: marks the self-declared identity ("identity self-declared via acceptance link …"). */
  evidenceNote?: string;
}

export interface AcceptanceResponse {
  acceptanceId: string;
  state: 'ACCEPTED';
}

@Injectable()
export class AcceptanceService {
  constructor(
    @Inject(TOKENS.AgreementVersionRepo) private readonly versions: AgreementVersionRepo,
    @Inject(TOKENS.AgreementDocumentRepo) private readonly documents: AgreementDocumentRepo,
    @Inject(TOKENS.CustomerRepo) private readonly customers: CustomerRepo,
    @Inject(TOKENS.CustomerVersionStateRepo) private readonly states: CustomerVersionStateRepo,
    @Inject(TOKENS.AcceptanceRepo) private readonly acceptances: AcceptanceRepo,
    @Inject(CONSENT_TOKENS.IdempotencyStore) private readonly idempotency: IdempotencyStore,
    @Inject(CONSENT_TOKENS.IdGenerator) private readonly ids: IdGenerator,
    @Inject(TOKENS.Clock) private readonly clock: Clock,
  ) {}

  async accept(input: AcceptanceInput): Promise<AcceptanceResponse> {
    const idemKey = `acceptance:${input.customerId}:${input.idempotencyKey}`;
    const replay = await this.idempotency.get<AcceptanceResponse>(idemKey);
    if (replay) {
      return replay;
    }

    // putIfAbsent reservation: exactly ONE request per key is processed; a
    // parallel/repeated request with the same key waits for the stored response and receives
    // the 201 replay instead of a 409 from the ALREADY_ACCEPTED race.
    const reserved = await this.idempotency.reserve(idemKey);
    if (!reserved) {
      return this.awaitReplay(idemKey);
    }

    try {
      const response = await this.process(input);
      await this.idempotency.put(idemKey, response);
      return response;
    } catch (err) {
      // Error path: release the reservation so a corrected retry with the same key is possible.
      await this.idempotency.release(idemKey);
      throw err;
    }
  }

  private async process(input: AcceptanceInput): Promise<AcceptanceResponse> {
    const version = await this.versions.findById(input.versionId);
    if (!version) {
      throw new DomainError('VERSION_NOT_FOUND');
    }
    const document = await this.documents.findById(version.documentId);
    if (!document) {
      throw new DomainError('VERSION_NOT_FOUND');
    }

    // Current OR upcoming (PUBLISHED, validFrom in the future) — advance acceptance is valid.
    const now = this.clock.now();
    const current = await this.versions.findCurrentPublished(document.type, document.audience, now);
    assertVersionCurrent(version, current, now);

    const customer = await this.customers.findById(input.customerId);
    if (!customer) {
      throw new DomainError('CUSTOMER_NOT_FOUND');
    }
    assertCustomerHasRole(customer, document.audience);

    assertDisplayedConsentTextMatches(version, input.displayedConsentText);
    const channel = input.channel ?? 'PORTAL';
    assertMethodChannelAllowed('ACTIVE_CONSENT', channel);

    // Load the state or — for onboarding/role extension — create it.
    const existing = await this.states.findByCustomerAndVersion(input.customerId, input.versionId);
    const state: CustomerVersionState = existing ?? {
      id: this.ids.next('cvs'),
      customerId: input.customerId,
      versionId: input.versionId,
      state: 'PENDING_NOTIFICATION',
      remindersSent: 0,
    };

    // Validate the transition first (throws ALREADY_ACCEPTED), only then write.
    const accepted = accept(state, 'ACTIVE_CONSENT');

    // State transition is conditional on the state that was read: if a parallel
    // path (publish→SUPERSEDED, second consent→ACCEPTED, sweeper) has changed the state in the
    // meantime, the UPDATE does not apply and NOTHING is written. The transition deliberately
    // happens BEFORE the acceptance append: a missed precondition never leaves an orphaned
    // consent record behind.
    if (existing) {
      const transitioned = await this.states.transition(existing.id, existing.state, { state: 'ACCEPTED' });
      if (!transitioned) {
        await this.throwStaleStateError(existing.id);
      }
    } else {
      await this.states.save(accepted);
    }

    const acceptance: Acceptance = {
      id: this.ids.next('a'),
      customerId: input.customerId,
      versionId: input.versionId,
      method: 'ACTIVE_CONSENT',
      channel,
      acceptedAt: this.clock.now(),
      actor: input.context.actor,
      isEffective: true,
      consentText: version.consentText,
      consentTextHash: consentTextHashFor(version),
      contentHash: version.contentHash,
      ipAddress: input.context.ipAddress,
      userAgent: input.context.userAgent,
      evidenceNote: input.evidenceNote,
    };
    // TODO(prisma): the acceptance append + state transition run as two separate writes here —
    // in REPOSITORY_DRIVER=prisma mode they are not wrapped in ONE transaction (no cross-repo
    // UnitOfWork). Current safeguards: conditional transition() + partial unique index
    // "one effective acceptance". See docs/PERSISTENCE.md "Open items: transactionality".
    await this.acceptances.append(acceptance);

    return { acceptanceId: acceptance.id, state: 'ACCEPTED' };
  }

  /**
   * Another request holds the reservation for this key: briefly wait for its response (replay).
   * If the wait times out (processing is still running, or it just failed and was released),
   * we reject instead of processing the same consent twice.
   */
  private async awaitReplay(idemKey: string): Promise<AcceptanceResponse> {
    for (let attempt = 0; attempt < AcceptanceService.REPLAY_POLL_ATTEMPTS; attempt++) {
      const replay = await this.idempotency.get<AcceptanceResponse>(idemKey);
      if (replay) {
        return replay;
      }
      await new Promise((resolve) => setTimeout(resolve, AcceptanceService.REPLAY_POLL_INTERVAL_MS));
    }
    throw new DomainError(
      'INVALID_STATE',
      'A request with the same idempotency key is currently being processed — please retry',
    );
  }

  private static readonly REPLAY_POLL_ATTEMPTS = 50;
  private static readonly REPLAY_POLL_INTERVAL_MS = 10;

  /** The conditional transition missed its precondition: raise a precise error based on the current state. */
  private async throwStaleStateError(stateId: string): Promise<never> {
    const current = await this.states.findById(stateId);
    if (current?.state === 'ACCEPTED') {
      throw new DomainError('ALREADY_ACCEPTED');
    }
    throw new DomainError(
      'INVALID_STATE',
      `CustomerVersionState ${stateId} was changed concurrently (now: ${current?.state ?? 'unknown'})`,
    );
  }
}

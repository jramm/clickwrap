/**
 * Pending agreements service — content for the portal popup
 * (GET /customers/:customerId/pending-agreements). Returns one item per current PUBLISHED
 * version with an open state — plus one per UPCOMING published version (validFrom in the
 * future, marked `upcoming: true`) so acceptance can be collected in advance; the current one
 * and any number of future ones may be open simultaneously (every future version is listed, not
 * just the next). ACCEPTED/OBJECTED/SUPERSEDED never appear (nothing left to do or no block).
 */
import { Inject, Injectable } from '@nestjs/common';
import { DomainError } from '../common/errors.js';
import type { Clock } from '../domain/clock.js';
import { isBlocking } from '../domain/state-machine.js';
import type {
  AgreementDocumentRepo,
  AgreementVersionRepo,
  AudienceRepo,
  CustomerRepo,
  CustomerVersionStateRepo,
} from '../domain/ports.js';
import type { AcceptanceMode, CustomerVersionStateValue } from '../domain/types.js';
import { TOKENS } from '../persistence/tokens.js';
import { resolveAudienceKey } from './audience.js';
import { PDF_URL_PROVIDER, type PdfUrlProvider } from './ports/pdf-url-provider.js';

/** Open (non-terminal) states shown in the popup — ACCEPTED/OBJECTED/SUPERSEDED are not. */
const OPEN_STATES: readonly CustomerVersionStateValue[] = ['PENDING_NOTIFICATION', 'NOTIFIED', 'EXPIRED_BLOCKING'];

export interface PendingAgreementItem {
  versionId: string;
  /** Document type key. */
  documentType: string;
  /** Human-readable document name (heading), falls back to the type key when unnamed. */
  documentName: string;
  /** Audience key. */
  audience: string;
  versionLabel: string;
  changeSummary: string;
  pdfUrl: string;
  mode: AcceptanceMode;
  /**
   * ACTIVE only — the exact checkbox consent text. The acceptance POST must echo it verbatim
   * (server-side CONSENT_TEXT_MISMATCH check), so a consumer that records acceptances MUST surface
   * this value and send it back. Undefined for PASSIVE (no consent checkbox).
   */
  consentText?: string;
  deadlineAt?: Date;
  blocking: boolean;
  /** true = published but not yet in effect (validFrom in the future) — advance acceptance. */
  upcoming: boolean;
  /** Date from which the revision applies (informational; relevant for upcoming items). */
  validFrom: Date;
  /** PASSIVE, in-effect items may still be objected to within the objection period. */
  canObject: boolean;
  /** PASSIVE only — version-specific text explaining what objecting means (undefined when none). */
  objectionConsequence?: string;
}

@Injectable()
export class PendingAgreementsService {
  constructor(
    @Inject(TOKENS.CustomerRepo) private readonly customers: CustomerRepo,
    @Inject(TOKENS.AudienceRepo) private readonly audiences: AudienceRepo,
    @Inject(TOKENS.AgreementDocumentRepo) private readonly documents: AgreementDocumentRepo,
    @Inject(TOKENS.AgreementVersionRepo) private readonly versions: AgreementVersionRepo,
    @Inject(TOKENS.CustomerVersionStateRepo) private readonly states: CustomerVersionStateRepo,
    @Inject(TOKENS.Clock) private readonly clock: Clock,
    @Inject(PDF_URL_PROVIDER) private readonly pdfUrlProvider: PdfUrlProvider,
  ) {}

  /** Popup content for the requesting tool; without audience: aggregation across all roles (empty = nothing to show). */
  async getPendingAgreements(customerId: string, audience?: string): Promise<PendingAgreementItem[]> {
    const audienceKey = await resolveAudienceKey(this.audiences, audience);
    const customer = await this.customers.findById(customerId);
    if (!customer) {
      throw new DomainError('CUSTOMER_NOT_FOUND');
    }
    const relevantAudiences = audienceKey
      ? customer.roles.filter((role) => role === audienceKey)
      : customer.roles;

    const now = this.clock.now();
    const items: PendingAgreementItem[] = [];
    // Iterates the dynamic document set instead of a hardcoded (type × audience) matrix.
    for (const document of await this.documents.findAll()) {
      if (!relevantAudiences.includes(document.audience)) {
        continue;
      }
      // Current AND every upcoming revision may be open at the same time (scheduled publish):
      // the current one remains the compliance baseline, each upcoming one is offered for
      // advance acceptance and is marked `upcoming: true`. Several futures may be scheduled at
      // once — all are listed (ordered by validFrom asc), not just the next.
      const current = await this.versions.findCurrentPublished(document.type, document.audience, now);
      const upcoming = await this.versions.findUpcomingPublishedList(document.type, document.audience, now);
      for (const { version, isUpcoming } of [
        { version: current, isUpcoming: false },
        ...upcoming.map((version) => ({ version, isUpcoming: true })),
      ]) {
        if (!version) {
          continue;
        }
        const state = await this.states.findByCustomerAndVersion(customerId, version.id);
        if (!state || !OPEN_STATES.includes(state.state)) {
          continue;
        }

        items.push({
          versionId: version.id,
          documentType: document.type,
          documentName: document.name ?? document.type,
          audience: document.audience,
          versionLabel: version.versionLabel,
          changeSummary: version.changeSummary,
          pdfUrl: await this.pdfUrlProvider.getPresignedUrl(version.storageKey),
          mode: version.acceptanceMode,
          consentText: version.consentText,
          deadlineAt: state.deadlineAt,
          blocking: isBlocking(state),
          upcoming: isUpcoming,
          validFrom: version.validFrom,
          // PASSIVE, in-effect items can be objected to within the objection period (same rule the
          // hosted acceptance page uses); ACTIVE / upcoming items cannot.
          canObject: version.acceptanceMode === 'PASSIVE' && !isUpcoming,
          objectionConsequence: version.objectionConsequence,
        });
      }
    }
    return items;
  }
}

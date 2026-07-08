/**
 * Pending agreements service — content for the portal popup
 * (GET /customers/:customerId/pending-agreements). Returns one item per current PUBLISHED
 * version with an open state — plus one per UPCOMING published version (validFrom in the
 * future, marked `upcoming: true`) so acceptance can be collected in advance; both may be open
 * simultaneously. ACCEPTED/OBJECTED/SUPERSEDED never appear (nothing left to do or no block).
 */
import { Inject, Injectable } from '@nestjs/common';
import { DomainError } from '../common/errors';
import type { Clock } from '../domain/clock';
import { isBlocking } from '../domain/state-machine';
import type {
  AgreementDocumentRepo,
  AgreementVersionRepo,
  AudienceRepo,
  CustomerRepo,
  CustomerVersionStateRepo,
} from '../domain/ports';
import type { AcceptanceMode, CustomerVersionStateValue } from '../domain/types';
import { TOKENS } from '../persistence/tokens';
import { resolveAudienceKey } from './audience';
import { PDF_URL_PROVIDER, type PdfUrlProvider } from './ports/pdf-url-provider';

/** Open (non-terminal) states shown in the popup — ACCEPTED/OBJECTED/SUPERSEDED are not. */
const OPEN_STATES: readonly CustomerVersionStateValue[] = ['PENDING_NOTIFICATION', 'NOTIFIED', 'EXPIRED_BLOCKING'];

export interface PendingAgreementItem {
  versionId: string;
  /** Document type key. */
  documentType: string;
  /** Audience key. */
  audience: string;
  versionLabel: string;
  changeSummary: string;
  pdfUrl: string;
  mode: AcceptanceMode;
  deadlineAt?: Date;
  blocking: boolean;
  /** true = published but not yet in effect (validFrom in the future) — advance acceptance. */
  upcoming: boolean;
  /** Date from which the revision applies (informational; relevant for upcoming items). */
  validFrom: Date;
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
      // Current AND upcoming revision may both be open at the same time (scheduled publish):
      // the current one remains the compliance baseline, the upcoming one is offered for
      // advance acceptance and is marked `upcoming: true`.
      const current = await this.versions.findCurrentPublished(document.type, document.audience, now);
      const upcoming = await this.versions.findUpcomingPublished(document.type, document.audience, now);
      for (const { version, isUpcoming } of [
        { version: current, isUpcoming: false },
        { version: upcoming, isUpcoming: true },
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
          audience: document.audience,
          versionLabel: version.versionLabel,
          changeSummary: version.changeSummary,
          pdfUrl: await this.pdfUrlProvider.getPresignedUrl(version.storageKey),
          mode: version.acceptanceMode,
          deadlineAt: state.deadlineAt,
          blocking: isBlocking(state),
          upcoming: isUpcoming,
          validFrom: version.validFrom,
        });
      }
    }
    return items;
  }
}

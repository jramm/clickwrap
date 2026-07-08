/**
 * Hosted acceptance page — resolves the capability token, assembles the page content and runs
 * the two writing flows through the SAME services as the portal popup (evidence-chain
 * guarantees stay in one place):
 *
 *  - Rendering the page counts as provable access: NotificationService.notify(channel=LINK) per
 *    pending item — atomic recordAccess, deadlines start, carryOverBlocking respected,
 *    SUPERSEDED is never resurrected.
 *  - Accepting goes through AcceptanceService (channel=LINK): current-version check, role
 *    coverage, CONSENT_TEXT_MISMATCH, ALREADY_ACCEPTED — identical to the popup path. The actor
 *    is the SELF-DECLARED signer, attributed to the link (`link:<linkId>`) and marked in the
 *    evidenceNote.
 *
 * Unknown/expired/revoked tokens are indistinguishable to the caller (uniform 404).
 */
import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DomainError } from '../common/errors';
import {
  acceptanceLinkActorUserId,
  acceptanceLinkEvidenceNote,
  acceptanceLinkTokenHash,
  isAcceptanceLinkUsable,
} from '../domain/acceptance-links';
import type { Clock } from '../domain/clock';
import type { AcceptanceLinkRepo, AgreementDocumentRepo, AgreementVersionRepo, CustomerRepo } from '../domain/ports';
import type { AcceptanceLink, AcceptanceMode } from '../domain/types';
import { TOKENS } from '../persistence/tokens';
import { PendingAgreementsService } from '../compliance/pending-agreements.service';
import { AcceptanceService, type AcceptanceResponse } from '../consent/acceptance.service';
import { NotificationService } from '../consent/notification.service';

export interface AcceptPageItem {
  versionId: string;
  documentName: string;
  documentType: string;
  audience: string;
  versionLabel: string;
  changeSummary: string;
  /** Presigned URL (15-minute TTL, same source as the portal popup). */
  pdfUrl: string;
  mode: AcceptanceMode;
  /** ACTIVE only — the exact checkbox text; the acceptance POST must echo it verbatim. */
  consentText?: string;
  deadlineAt?: Date;
  blocking: boolean;
  /** true = published but not yet in effect — the card shows "valid from {date}". */
  upcoming: boolean;
  /** Date from which the revision applies. */
  validFrom: Date;
}

export interface AcceptPageView {
  linkId: string;
  customerName: string;
  items: AcceptPageItem[];
}

export interface LinkAcceptanceRequest {
  versionId: string;
  displayedConsentText: string;
  signerName: string;
  signerEmail: string;
  ipAddress?: string;
  userAgent?: string;
  /** Supplied by the page's inline JS; a server-side random key is the fallback. */
  idempotencyKey?: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

@Injectable()
export class AcceptPageService {
  constructor(
    @Inject(TOKENS.AcceptanceLinkRepo) private readonly links: AcceptanceLinkRepo,
    @Inject(TOKENS.CustomerRepo) private readonly customers: CustomerRepo,
    @Inject(TOKENS.AgreementVersionRepo) private readonly versions: AgreementVersionRepo,
    @Inject(TOKENS.AgreementDocumentRepo) private readonly documents: AgreementDocumentRepo,
    private readonly pendingAgreements: PendingAgreementsService,
    private readonly notifications: NotificationService,
    private readonly acceptances: AcceptanceService,
    @Inject(TOKENS.Clock) private readonly clock: Clock,
  ) {}

  /**
   * Page content for a raw URL token; `undefined` = render the uniform 404 (unknown, expired,
   * revoked — deliberately indistinguishable). Rendering records the access proof per pending
   * item and touches lastUsedAt.
   */
  async loadPage(token: string): Promise<AcceptPageView | undefined> {
    const link = await this.resolveUsableLink(token);
    if (!link) {
      return undefined;
    }
    const customer = await this.customers.findById(link.customerId);
    if (!customer) {
      return undefined; // dangling link — same uniform 404, never an error page
    }

    const pending = await this.pendingAgreements.getPendingAgreements(link.customerId, link.audienceKey);
    const items: AcceptPageItem[] = [];
    for (const item of pending) {
      // Access proof — exactly the portal-popup path: atomic, first access wins, deadlines
      // start, carryOverBlocking respected, SUPERSEDED never resurrected.
      const notified = await this.notifications.notify({
        customerId: link.customerId,
        versionId: item.versionId,
        channel: 'LINK',
        context: { customerId: link.customerId, actor: { userId: acceptanceLinkActorUserId(link.id) } },
      });
      const version = await this.versions.findById(item.versionId);
      const document = version ? await this.documents.findById(version.documentId) : undefined;
      items.push({
        versionId: item.versionId,
        documentName: document?.name ?? item.documentType,
        documentType: item.documentType,
        audience: item.audience,
        versionLabel: item.versionLabel,
        changeSummary: item.changeSummary,
        pdfUrl: item.pdfUrl,
        mode: item.mode,
        consentText: version?.consentText,
        deadlineAt: notified.deadlineAt ?? item.deadlineAt,
        blocking: item.blocking,
        upcoming: item.upcoming,
        validFrom: item.validFrom,
      });
    }

    await this.links.touch(link.id, this.clock.now());
    return { linkId: link.id, customerName: customer.name ?? '', items };
  }

  /** Acceptance through the link — the link token is the auth, the signer is self-declared. */
  async accept(token: string, request: LinkAcceptanceRequest): Promise<AcceptanceResponse> {
    const link = await this.resolveUsableLink(token);
    if (!link) {
      throw new DomainError('LINK_NOT_FOUND', 'Acceptance link not found');
    }
    const signerName = request.signerName.trim();
    const signerEmail = request.signerEmail.trim();
    if (signerName === '') {
      throw new DomainError('INVALID_STATE', 'signerName must not be empty');
    }
    if (!EMAIL_PATTERN.test(signerEmail)) {
      throw new DomainError('INVALID_STATE', `Invalid signer e-mail: ${signerEmail}`);
    }
    await this.assertVersionInLinkScope(link, request.versionId);

    const response = await this.acceptances.accept({
      customerId: link.customerId,
      versionId: request.versionId,
      displayedConsentText: request.displayedConsentText,
      idempotencyKey: request.idempotencyKey ?? randomUUID(),
      channel: 'LINK',
      evidenceNote: acceptanceLinkEvidenceNote(link.id),
      context: {
        customerId: link.customerId,
        actor: { userId: acceptanceLinkActorUserId(link.id), name: signerName, email: signerEmail },
        ipAddress: request.ipAddress,
        userAgent: request.userAgent,
      },
    });
    await this.links.touch(link.id, this.clock.now());
    return response;
  }

  private async resolveUsableLink(token: string): Promise<AcceptanceLink | undefined> {
    const link = await this.links.findByTokenHash(acceptanceLinkTokenHash(token));
    if (!link || !isAcceptanceLinkUsable(link, this.clock.now())) {
      return undefined;
    }
    return link;
  }

  /** A scoped link is a capability for ONE audience — versions outside the scope stay invisible. */
  private async assertVersionInLinkScope(link: AcceptanceLink, versionId: string): Promise<void> {
    if (link.audienceKey === undefined) {
      return;
    }
    const version = await this.versions.findById(versionId);
    if (!version) {
      return; // AcceptanceService raises the canonical VERSION_NOT_FOUND
    }
    const document = await this.documents.findById(version.documentId);
    if (document && document.audience !== link.audienceKey) {
      throw new DomainError('VERSION_NOT_FOUND', 'Version is not available through this acceptance link');
    }
  }
}

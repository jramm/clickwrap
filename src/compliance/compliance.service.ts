/**
 * Compliance service — tool gate "may the customer enter the respective audience application?"
 * (GET /customers/:customerId/compliance). Loads master data / current versions /
 * states, calls the pure domain function `computeCompliance` and enriches the details with
 * acceptance evidence.
 */
import { Inject, Injectable } from '@nestjs/common';
import { DomainError } from '../common/errors.js';
import type { Clock } from '../domain/clock.js';
import { computeCompliance, type ComplianceDetail, type CurrentVersionEntry } from '../domain/compliance.js';
import { detailKey } from '../domain/keys.js';
import type {
  AcceptanceRepo,
  AgreementDocumentRepo,
  AgreementVersionRepo,
  AudienceRepo,
  CustomerRepo,
  CustomerVersionStateRepo,
} from '../domain/ports.js';
import type { AcceptanceMethod, AcceptanceMode, CustomerVersionStateValue } from '../domain/types.js';
import { TOKENS } from '../persistence/tokens.js';
import { resolveAudienceKey } from './audience.js';

/** Detail schema — no `compliant` field per entry (only the aggregate on top). */
export interface ComplianceDetailResponse {
  requiredVersionId: string;
  requiredVersionLabel: string;
  acceptedVersionId?: string;
  state?: CustomerVersionStateValue;
  method?: AcceptanceMethod;
  deadlineAt?: Date;
  pendingMode?: AcceptanceMode;
}

export interface ComplianceResponse {
  customerId: string;
  /** Audience key the query was restricted to (if any). */
  audience?: string;
  /** Audience keys of the customer. */
  roles: string[];
  compliant: boolean;
  details: Record<string, ComplianceDetailResponse>;
}

@Injectable()
export class ComplianceService {
  constructor(
    @Inject(TOKENS.CustomerRepo) private readonly customers: CustomerRepo,
    @Inject(TOKENS.AudienceRepo) private readonly audiences: AudienceRepo,
    @Inject(TOKENS.AgreementDocumentRepo) private readonly documents: AgreementDocumentRepo,
    @Inject(TOKENS.AgreementVersionRepo) private readonly versions: AgreementVersionRepo,
    @Inject(TOKENS.CustomerVersionStateRepo) private readonly states: CustomerVersionStateRepo,
    @Inject(TOKENS.AcceptanceRepo) private readonly acceptances: AcceptanceRepo,
    @Inject(TOKENS.Clock) private readonly clock: Clock,
  ) {}

  /** Answers the tool gate for a customer; without audience: aggregation across all roles. */
  async getCompliance(customerId: string, audience?: string): Promise<ComplianceResponse> {
    const audienceKey = await resolveAudienceKey(this.audiences, audience);
    const customer = await this.customers.findById(customerId);
    if (!customer) {
      throw new DomainError('CUSTOMER_NOT_FOUND');
    }

    const currentVersions = await this.loadCurrentVersions();
    const states = await this.states.findByCustomer(customerId);
    const result = computeCompliance(customer, currentVersions, states, audienceKey);

    const details: Record<string, ComplianceDetailResponse> = {};
    for (const [key, detail] of Object.entries(result.details)) {
      details[key] = await this.enrichDetail(customerId, currentVersions, key, detail);
    }

    return {
      customerId: result.customerId,
      audience: result.audience,
      roles: result.roles,
      compliant: result.compliant,
      details,
    };
  }

  /**
   * Current PUBLISHED version per document — basis for computeCompliance. Iterates the
   * dynamic document set instead of a hardcoded (type × audience) matrix.
   */
  private async loadCurrentVersions(): Promise<CurrentVersionEntry[]> {
    const now = this.clock.now();
    const entries: CurrentVersionEntry[] = [];
    for (const document of await this.documents.findAll()) {
      const version = await this.versions.findCurrentPublished(document.type, document.audience, now);
      if (!version) {
        continue;
      }
      entries.push({ document, version });
    }
    return entries;
  }

  /**
   * acceptedVersionId/method = the customer's latest effective consent to this document — may be
   * older than the required version (popup still outstanding). Searches backwards through the
   * document's version history via AcceptanceRepo.findEffective until an effective consent is
   * found.
   */
  private async enrichDetail(
    customerId: string,
    currentVersions: readonly CurrentVersionEntry[],
    key: string,
    detail: ComplianceDetail,
  ): Promise<ComplianceDetailResponse> {
    const base: ComplianceDetailResponse = {
      requiredVersionId: detail.requiredVersionId,
      requiredVersionLabel: detail.requiredVersionLabel,
      state: detail.state,
      pendingMode: detail.pendingMode,
      deadlineAt: detail.deadlineAt,
    };

    const entry = currentVersions.find((e) => detailKey(e.document.type, e.document.audience) === key);
    if (!entry) {
      return base;
    }

    const documentVersions = await this.versions.findByDocument(entry.document.id);
    const newestFirst = [...documentVersions].sort(
      (a, b) =>
        b.validFrom.getTime() - a.validFrom.getTime() ||
        (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0),
    );

    for (const version of newestFirst) {
      const acceptance = await this.acceptances.findEffective(customerId, version.id);
      if (acceptance) {
        return { ...base, acceptedVersionId: acceptance.versionId, method: acceptance.method };
      }
    }
    return base;
  }
}

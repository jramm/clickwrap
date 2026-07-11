import { Inject, Injectable, Optional } from '@nestjs/common';
import { DomainError } from '../common/errors.js';
import type { Clock } from '../domain/clock.js';
import type {
  AcceptanceRepo,
  AgreementDocumentRepo,
  AgreementVersionRepo,
  CustomerRepo,
  CustomerVersionStateRepo,
} from '../domain/ports.js';
import { TOKENS } from '../persistence/tokens.js';
import type {
  AcceptanceChannel,
  AcceptanceMethod,
  AgreementDocument,
  AgreementVersion,
  VersionStatus,
} from '../domain/types.js';

/** All acceptance channels — every bucket is always present (0 when empty). */
const CHANNELS: readonly AcceptanceChannel[] = ['PORTAL', 'LINK', 'ADMIN', 'SYSTEM'];
/** All acceptance methods — every bucket is always present (0 when empty). */
const METHODS: readonly AcceptanceMethod[] = ['ACTIVE_CONSENT', 'TACIT', 'IMPORT'];

/**
 * Per-version acceptance counters. The population is the set of RELEVANT states — every
 * CustomerVersionState of the version whose value is NOT SUPERSEDED (a superseded state belongs to
 * an old revision the customer was moved off, so it must not dilute this version's numbers):
 *
 * - `totalCustomers` — count of relevant (non-SUPERSEDED) states.
 * - `accepted` — states in ACCEPTED.
 * - `pending` — states in PENDING_NOTIFICATION or NOTIFIED.
 * - `blocked` — states in EXPIRED_BLOCKING.
 * - `objected` — states in OBJECTED.
 * - `acceptedByChannel` / `acceptedByMethod` — the EFFECTIVE acceptance of every accepted customer,
 *   bucketed by channel resp. method. Each sums to `accepted`.
 * - `acceptanceRate` — accepted / totalCustomers, or 0 when totalCustomers is 0.
 */
export interface VersionAcceptanceStats {
  totalCustomers: number;
  accepted: number;
  acceptedByChannel: Record<AcceptanceChannel, number>;
  acceptedByMethod: Record<AcceptanceMethod, number>;
  pending: number;
  blocked: number;
  objected: number;
  acceptanceRate: number;
}

export interface VersionStats {
  versionId: string;
  documentName: string;
  documentType: string;
  audience: string;
  versionLabel: string;
  status: VersionStatus;
  validFrom: Date;
  /** true when the version is scheduled for the future (validFrom > now) — advance acceptance. */
  upcoming: boolean;
  stats: VersionAcceptanceStats;
}

export interface DashboardResult {
  items: VersionStats[];
}

/**
 * Per-version acceptance dashboard. `dashboard()` returns one entry per RELEVANT version — the
 * current published version plus EVERY upcoming (scheduled) published version of every document
 * (not just the next one — several futures may be scheduled at once); `versionStats(id)` returns
 * the same shape for a single version.
 */
@Injectable()
export class DashboardService {
  constructor(
    @Inject(TOKENS.AgreementDocumentRepo) private readonly documents: AgreementDocumentRepo,
    @Inject(TOKENS.AgreementVersionRepo) private readonly versions: AgreementVersionRepo,
    @Inject(TOKENS.CustomerVersionStateRepo) private readonly states: CustomerVersionStateRepo,
    @Inject(TOKENS.AcceptanceRepo) private readonly acceptances: AcceptanceRepo,
    @Inject(TOKENS.Clock) private readonly clock: Clock,
    // Optional so the many direct-instantiation unit tests keep working; when absent no customer is
    // treated as deleted (the states of soft-deleted, sync-removed customers are then still counted).
    @Optional() @Inject(TOKENS.CustomerRepo) private readonly customers?: CustomerRepo,
  ) {}

  async dashboard(): Promise<DashboardResult> {
    const now = this.clock.now();
    const deletedIds = await this.deletedCustomerIds();
    const items: VersionStats[] = [];
    for (const document of await this.documents.findAll()) {
      const relevant = [
        await this.versions.findCurrentPublished(document.type, document.audience, now),
        ...(await this.versions.findUpcomingPublishedList(document.type, document.audience, now)),
      ];
      for (const version of relevant) {
        if (version) {
          items.push(await this.buildStats(version, document, now, deletedIds));
        }
      }
    }
    items.sort(
      (a, b) =>
        a.documentName.localeCompare(b.documentName) ||
        Number(a.upcoming) - Number(b.upcoming) ||
        a.validFrom.getTime() - b.validFrom.getTime(),
    );
    return { items };
  }

  async versionStats(versionId: string): Promise<VersionStats> {
    const version = await this.versions.findById(versionId);
    if (!version) {
      throw new DomainError('VERSION_NOT_FOUND', `Version ${versionId} not found`);
    }
    const document = await this.documents.findById(version.documentId);
    if (!document) {
      throw new DomainError('INVALID_STATE', `Document ${version.documentId} does not exist`);
    }
    return this.buildStats(version, document, this.clock.now(), await this.deletedCustomerIds());
  }

  /** Ids of soft-deleted (sync-removed) customers — their states never count towards a version's stats. */
  private async deletedCustomerIds(): Promise<Set<string>> {
    if (!this.customers) {
      return new Set();
    }
    const all = await this.customers.findAll();
    return new Set(all.filter((c) => c.deletedAt !== undefined).map((c) => c.id));
  }

  private async buildStats(
    version: AgreementVersion,
    document: AgreementDocument,
    now: Date,
    deletedIds: Set<string>,
  ): Promise<VersionStats> {
    const stats = await this.computeStats(version.id, deletedIds);
    return {
      versionId: version.id,
      documentName: document.name,
      documentType: document.type,
      audience: document.audience,
      versionLabel: version.versionLabel,
      status: version.status,
      validFrom: version.validFrom,
      upcoming: version.validFrom.getTime() > now.getTime(),
      stats,
    };
  }

  private async computeStats(versionId: string, deletedIds: Set<string>): Promise<VersionAcceptanceStats> {
    const relevant = (await this.states.findByVersion(versionId)).filter(
      (s) => s.state !== 'SUPERSEDED' && !deletedIds.has(s.customerId),
    );
    const acceptedCustomerIds = new Set(
      relevant.filter((s) => s.state === 'ACCEPTED').map((s) => s.customerId),
    );

    const acceptedByChannel = Object.fromEntries(CHANNELS.map((c) => [c, 0])) as Record<AcceptanceChannel, number>;
    const acceptedByMethod = Object.fromEntries(METHODS.map((m) => [m, 0])) as Record<AcceptanceMethod, number>;
    for (const acceptance of await this.acceptances.findEffectiveByVersion(versionId)) {
      // Only the effective acceptances of customers still ACCEPTED for this version count — a
      // customer whose state has been superseded is excluded from the breakdown too.
      if (!acceptedCustomerIds.has(acceptance.customerId)) {
        continue;
      }
      acceptedByChannel[acceptance.channel]++;
      acceptedByMethod[acceptance.method]++;
    }

    const totalCustomers = relevant.length;
    const accepted = acceptedCustomerIds.size;
    return {
      totalCustomers,
      accepted,
      acceptedByChannel,
      acceptedByMethod,
      pending: relevant.filter((s) => s.state === 'PENDING_NOTIFICATION' || s.state === 'NOTIFIED').length,
      blocked: relevant.filter((s) => s.state === 'EXPIRED_BLOCKING').length,
      objected: relevant.filter((s) => s.state === 'OBJECTED').length,
      acceptanceRate: totalCustomers === 0 ? 0 : accepted / totalCustomers,
    };
  }
}

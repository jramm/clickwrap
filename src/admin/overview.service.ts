import { Inject, Injectable } from '@nestjs/common';
import { computeCompliance, type CurrentVersionEntry } from '../domain/compliance';
import { customerDisplayName } from '../domain/customer';
import { TOKENS } from '../persistence/tokens';
import type { Clock } from '../domain/clock';
import type {
  AcceptanceRepo,
  AgreementDocumentRepo,
  AgreementVersionRepo,
  CustomerRepo,
  CustomerVersionStateRepo,
} from '../domain/ports';
import { detailKey } from '../domain/keys';
import { matchesCustomerSearch } from '../customers/customer-search';
import type {
  AcceptanceMethod,
  AgreementVersion,
  Customer,
  CustomerVersionState,
  CustomerVersionStateValue,
} from '../domain/types';

export type OverviewFilter =
  | 'non_compliant'
  | 'pending'
  | 'objected'
  | 'unreachable'
  | 'deadline_lt_7d';

export interface OverviewQuery {
  filter?: OverviewFilter;
  /** Audience key; an unknown key simply matches nothing. */
  audience?: string;
  /** Document type key; an unknown key simply matches nothing. */
  documentType?: string;
  /**
   * Case-insensitive substring on the customer's name / externalRef / contactEmails — identical
   * semantics to the admin customer list (see {@link matchesCustomerSearch}). Applied before
   * building the matrix rows; `total` reflects the filtered count.
   */
  search?: string;
  page?: number;
}

/** Cell per TYPE_AUDIENCE detail key. */
export interface OverviewCell {
  acceptedVersion?: string;
  method?: AcceptanceMethod;
  state?: CustomerVersionStateValue;
  requiredVersion?: string;
  deadlineAt?: Date;
  blocking: boolean;
}

export interface OverviewRow {
  customerId: string;
  /** Human-readable company name ('' when the CRM sync has not provided one). */
  customerName: string;
  /** Audience keys of the customer. */
  roles: string[];
  cells: Record<string, OverviewCell>;
}

export interface OverviewResult {
  items: OverviewRow[];
  total: number;
}

const PAGE_SIZE = 50;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

interface RelevantRecord {
  key: string;
  currentVersion: AgreementVersion;
  state?: CustomerVersionState;
  acceptedVersion?: AgreementVersion;
  acceptedMethod?: AcceptanceMethod;
}

/** Admin acceptance matrix with filters. */
@Injectable()
export class OverviewService {
  constructor(
    @Inject(TOKENS.CustomerRepo) private readonly customers: CustomerRepo,
    @Inject(TOKENS.AgreementDocumentRepo) private readonly documents: AgreementDocumentRepo,
    @Inject(TOKENS.AgreementVersionRepo) private readonly versions: AgreementVersionRepo,
    @Inject(TOKENS.CustomerVersionStateRepo) private readonly states: CustomerVersionStateRepo,
    @Inject(TOKENS.AcceptanceRepo) private readonly acceptances: AcceptanceRepo,
    @Inject(TOKENS.Clock) private readonly clock: Clock,
  ) {}

  async overview(query: OverviewQuery = {}): Promise<OverviewResult> {
    const now = this.clock.now();
    const currentEntries = await this.currentVersions(now);
    const all = await this.customers.findAll();
    const customers = query.search ? all.filter((c) => matchesCustomerSearch(c, query.search as string)) : all;

    const rows: OverviewRow[] = [];
    for (const customer of customers) {
      const row = await this.buildRow(customer, currentEntries, query, now);
      if (row) {
        rows.push(row);
      }
    }

    const total = rows.length;
    const page = query.page && query.page > 0 ? query.page : 1;
    const items = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    return { items, total };
  }

  private async currentVersions(now: Date): Promise<CurrentVersionEntry[]> {
    const documents = await this.documents.findAll();
    const entries: CurrentVersionEntry[] = [];
    for (const document of documents) {
      const version = await this.versions.findCurrentPublished(document.type, document.audience, now);
      if (version) {
        entries.push({ document, version });
      }
    }
    return entries;
  }

  private async buildRow(
    customer: Customer,
    currentEntries: CurrentVersionEntry[],
    query: OverviewQuery,
    now: Date,
  ): Promise<OverviewRow | undefined> {
    const customerStates = await this.states.findByCustomer(customer.id);
    const acceptedByDocument = await this.latestAcceptedByDocument(customer.id);

    const relevant: RelevantRecord[] = [];
    for (const { document, version } of currentEntries) {
      if (!customer.roles.includes(document.audience)) continue;
      if (query.audience && document.audience !== query.audience) continue;
      if (query.documentType && document.type !== query.documentType) continue;

      const state = customerStates.find((s) => s.versionId === version.id);
      const accepted = acceptedByDocument.get(document.id);
      relevant.push({
        key: detailKey(document.type, document.audience),
        currentVersion: version,
        state,
        acceptedVersion: accepted?.version,
        acceptedMethod: accepted?.method,
      });
    }

    if (relevant.length === 0) {
      // Customer without relevant documents → only keep the row when no restriction applies.
      const narrowed = query.filter || query.audience || query.documentType;
      return narrowed
        ? undefined
        : { customerId: customer.id, customerName: customerDisplayName(customer), roles: [...customer.roles], cells: {} };
    }

    const compliance = computeCompliance(customer, currentEntries, customerStates, query.audience);
    if (!this.matchesFilter(query.filter, relevant, compliance.compliant, now)) {
      return undefined;
    }

    const cells: Record<string, OverviewCell> = {};
    for (const record of relevant) {
      cells[record.key] = this.toCell(record);
    }
    return { customerId: customer.id, customerName: customerDisplayName(customer), roles: [...customer.roles], cells };
  }

  private toCell(record: RelevantRecord): OverviewCell {
    const acceptedCurrent = record.acceptedVersion?.id === record.currentVersion.id;
    const blocking = record.state?.state === 'EXPIRED_BLOCKING';
    const cell: OverviewCell = {
      acceptedVersion: record.acceptedVersion?.versionLabel,
      method: record.acceptedMethod,
      state: record.state?.state,
      blocking,
    };
    if (!acceptedCurrent) {
      cell.requiredVersion = record.currentVersion.versionLabel;
      if (record.state && (record.state.state === 'NOTIFIED' || record.state.state === 'EXPIRED_BLOCKING')) {
        cell.deadlineAt = record.state.deadlineAt;
      }
    }
    return cell;
  }

  private matchesFilter(
    filter: OverviewFilter | undefined,
    relevant: RelevantRecord[],
    compliant: boolean,
    now: Date,
  ): boolean {
    switch (filter) {
      case undefined:
        return true;
      case 'non_compliant':
        return !compliant;
      case 'objected':
        return relevant.some((r) => r.state?.state === 'OBJECTED');
      case 'unreachable':
        return relevant.some((r) => r.state?.state === 'PENDING_NOTIFICATION' && r.state.notifiedAt === undefined);
      case 'pending':
        return relevant.some(
          (r) => r.state?.state === 'PENDING_NOTIFICATION' || r.state?.state === 'NOTIFIED',
        );
      case 'deadline_lt_7d':
        return relevant.some(
          (r) =>
            r.state?.state === 'NOTIFIED' &&
            r.state.deadlineAt !== undefined &&
            r.state.deadlineAt.getTime() - now.getTime() < 7 * MS_PER_DAY &&
            r.state.deadlineAt.getTime() >= now.getTime(),
        );
      default:
        return true;
    }
  }

  /** Latest effective acceptance per document (across all versions of the document). */
  private async latestAcceptedByDocument(
    customerId: string,
  ): Promise<Map<string, { version: AgreementVersion; method: AcceptanceMethod }>> {
    const effective = (await this.acceptances.findByCustomer(customerId)).filter((a) => a.isEffective);
    const versionCache = new Map<string, AgreementVersion | undefined>();
    const result = new Map<string, { version: AgreementVersion; method: AcceptanceMethod; acceptedAt: number }>();

    for (const acceptance of effective) {
      if (!versionCache.has(acceptance.versionId)) {
        versionCache.set(acceptance.versionId, await this.versions.findById(acceptance.versionId));
      }
      const version = versionCache.get(acceptance.versionId);
      if (!version) continue;
      const existing = result.get(version.documentId);
      if (!existing || acceptance.acceptedAt.getTime() > existing.acceptedAt) {
        result.set(version.documentId, { version, method: acceptance.method, acceptedAt: acceptance.acceptedAt.getTime() });
      }
    }
    return new Map([...result].map(([k, v]) => [k, { version: v.version, method: v.method }]));
  }
}

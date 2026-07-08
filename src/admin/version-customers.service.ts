import { Inject, Injectable } from '@nestjs/common';
import { matchesCustomerSearch } from '../customers/customer-search';
import { TOKENS } from '../persistence/tokens';
import type { AcceptanceRepo, CustomerRepo, CustomerVersionStateRepo } from '../domain/ports';
import type {
  AcceptanceChannel,
  AcceptanceMethod,
  CustomerVersionStateValue,
} from '../domain/types';
import { DashboardService, type VersionStats } from './dashboard.service';

/**
 * State filter of the per-version customer view. Maps onto the raw
 * {@link CustomerVersionStateValue}s exactly like the dashboard buckets:
 * pending = PENDING_NOTIFICATION or NOTIFIED. SUPERSEDED is never selectable — it belongs to an
 * old revision and is excluded from this view entirely.
 */
export type VersionCustomerFilterState = 'accepted' | 'pending' | 'blocked' | 'objected';

const FILTER_STATES: Record<VersionCustomerFilterState, readonly CustomerVersionStateValue[]> = {
  accepted: ['ACCEPTED'],
  pending: ['PENDING_NOTIFICATION', 'NOTIFIED'],
  blocked: ['EXPIRED_BLOCKING'],
  objected: ['OBJECTED'],
};

/** The effective acceptance OF THIS VERSION only (never a sibling version's acceptance). */
export interface VersionCustomerAcceptance {
  acceptedAt: Date;
  method: AcceptanceMethod;
  channel: AcceptanceChannel;
  actorName?: string;
}

export interface VersionCustomerRow {
  customerId: string;
  /** Human-readable company name ('' when the CRM sync has not provided one). */
  customerName: string;
  externalRef: string;
  /** The CustomerVersionState value for THIS version (never relative to another version). */
  state: CustomerVersionStateValue;
  notifiedAt?: Date;
  deadlineAt?: Date;
  carryOverBlocking?: boolean;
  acceptance?: VersionCustomerAcceptance;
}

export interface VersionCustomersQuery {
  state?: VersionCustomerFilterState;
  /** Case-insensitive substring on name / externalRef / contactEmails (same helper as elsewhere). */
  search?: string;
  page?: number;
}

export interface VersionCustomersResult {
  items: VersionCustomerRow[];
  total: number;
  /** Reused DashboardService per-version stats so the header numbers match the dashboard card. */
  stats: VersionStats;
}

const PAGE_SIZE = 50;

/**
 * Per-version customer status view. Unlike the compliance overview — whose cells always reflect the
 * CURRENTLY EFFECTIVE version — every row here reports the customer's state and acceptance FOR THE
 * REQUESTED version, so drilling into an upcoming version shows who has (not) accepted THAT version.
 */
@Injectable()
export class VersionCustomersService {
  constructor(
    @Inject(TOKENS.CustomerRepo) private readonly customers: CustomerRepo,
    @Inject(TOKENS.CustomerVersionStateRepo) private readonly states: CustomerVersionStateRepo,
    @Inject(TOKENS.AcceptanceRepo) private readonly acceptances: AcceptanceRepo,
    private readonly dashboard: DashboardService,
  ) {}

  async list(versionId: string, query: VersionCustomersQuery = {}): Promise<VersionCustomersResult> {
    // Validates existence (throws VERSION_NOT_FOUND) and yields the exact same stats as the card.
    const stats = await this.dashboard.versionStats(versionId);

    const relevant = (await this.states.findByVersion(versionId)).filter(
      (s) => s.state !== 'SUPERSEDED',
    );
    const effectiveByCustomer = new Map(
      (await this.acceptances.findEffectiveByVersion(versionId)).map((a) => [a.customerId, a]),
    );
    const customersById = new Map((await this.customers.findAll()).map((c) => [c.id, c]));

    const allowed = query.state ? FILTER_STATES[query.state] : undefined;

    const rows: VersionCustomerRow[] = [];
    for (const state of relevant) {
      const customer = customersById.get(state.customerId);
      if (!customer) continue; // defensive: a state without a customer record
      if (allowed && !allowed.includes(state.state)) continue;
      if (query.search && !matchesCustomerSearch(customer, query.search)) continue;

      const acceptance = effectiveByCustomer.get(state.customerId);
      rows.push({
        customerId: customer.id,
        customerName: customer.name ?? '',
        externalRef: customer.externalRef,
        state: state.state,
        notifiedAt: state.notifiedAt,
        deadlineAt: state.deadlineAt,
        carryOverBlocking: state.carryOverBlocking,
        acceptance: acceptance
          ? {
              acceptedAt: acceptance.acceptedAt,
              method: acceptance.method,
              channel: acceptance.channel,
              actorName: acceptance.actor.name,
            }
          : undefined,
      });
    }

    rows.sort(
      (a, b) => a.customerName.localeCompare(b.customerName) || a.customerId.localeCompare(b.customerId),
    );

    const total = rows.length;
    const page = query.page && query.page > 0 ? query.page : 1;
    const items = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    return { items, total, stats };
  }
}

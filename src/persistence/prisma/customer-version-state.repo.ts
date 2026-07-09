/**
 * Prisma implementation of CustomerVersionStateRepo. Semantics exactly like
 * src/persistence/inmemory/customer-version-state.repo.ts:
 * - `save` is an upsert-by-id (aggregate upsert, like the fake).
 * - `setNotifiedAtomically` is literally
 *   `updateMany({ where: { id, notifiedAt: null, state: 'PENDING_NOTIFICATION' }, data })` —
 *   on the SQL side an `UPDATE … WHERE id = $1 AND "notifiedAt" IS NULL AND state = 'PENDING_NOTIFICATION'`,
 *   which only takes effect once under concurrent access (no lost update, no backdating, no
 *   resurrection of SUPERSEDED/ACCEPTED). The return value afterwards is always the
 *   currently stored state, regardless of whether this call actually wrote anything
 *   (idempotent, like the fake).
 * - `transition` is the conditional transition:
 *   `updateMany({ where: { id, state: expected }, data })`, followed by a re-read; count=0 → null.
 * - `findDueForSweep`/`findOpenByVersion` are plain WHERE filters on the two hot-path indexes
 *   (`@@index([state, deadlineAt])` resp. `@@index([customerId, state])` covers findByCustomer).
 */
import { Injectable } from '@nestjs/common';
import { DomainError } from '../../common/errors';
import type { CustomerVersionStateRepo, CustomerVersionStateTransition } from '../../domain/ports';
import type { CustomerVersionState } from '../../domain/types';
import { toDomain, toUpsertData } from './mappers/customer-version-state.mapper';
import { PrismaService } from './prisma.service';

const OPEN_STATES: readonly CustomerVersionState['state'][] = [
  'PENDING_NOTIFICATION',
  'NOTIFIED',
  'OBJECTED',
  'EXPIRED_BLOCKING',
];

@Injectable()
export class PrismaCustomerVersionStateRepo implements CustomerVersionStateRepo {
  constructor(private readonly prisma: PrismaService) {}

  async save(state: CustomerVersionState): Promise<CustomerVersionState> {
    const data = toUpsertData(state);
    const row = await this.prisma.customerVersionState.upsert({
      where: { id: state.id },
      create: { id: state.id, ...data },
      update: data,
    });
    return toDomain(row);
  }

  async findById(id: string): Promise<CustomerVersionState | undefined> {
    const row = await this.prisma.customerVersionState.findUnique({ where: { id } });
    return row ? toDomain(row) : undefined;
  }

  async findByCustomerAndVersion(customerId: string, versionId: string): Promise<CustomerVersionState | undefined> {
    const row = await this.prisma.customerVersionState.findUnique({
      where: { customerId_versionId: { customerId, versionId } },
    });
    return row ? toDomain(row) : undefined;
  }

  async findByCustomer(customerId: string): Promise<CustomerVersionState[]> {
    const rows = await this.prisma.customerVersionState.findMany({ where: { customerId } });
    return rows.map(toDomain);
  }

  async findOpenByVersion(versionId: string): Promise<CustomerVersionState[]> {
    const rows = await this.prisma.customerVersionState.findMany({
      where: { versionId, state: { in: [...OPEN_STATES] } },
    });
    return rows.map(toDomain);
  }

  async findByVersion(versionId: string): Promise<CustomerVersionState[]> {
    const rows = await this.prisma.customerVersionState.findMany({ where: { versionId } });
    return rows.map(toDomain);
  }

  async findDueForSweep(now: Date): Promise<CustomerVersionState[]> {
    // PENDING_NOTIFICATION with a due deadlineAt = an ACTIVE customer under the absolute hard
    // deadline (stamped at rollout, before any access); PASSIVE PENDING have deadlineAt IS NULL and
    // are excluded by the `lte` filter. Covered by @@index([state, deadlineAt]).
    const rows = await this.prisma.customerVersionState.findMany({
      where: { state: { in: ['PENDING_NOTIFICATION', 'NOTIFIED'] }, deadlineAt: { lte: now } },
    });
    return rows.map(toDomain);
  }

  async setNotifiedAtomically(
    id: string,
    update: Pick<CustomerVersionState, 'state' | 'notifiedAt' | 'deadlineAt'>,
  ): Promise<CustomerVersionState> {
    // WHERE notifiedAt IS NULL AND state='PENDING_NOTIFICATION': the first access wins, and a
    // SUPERSEDED/ACCEPTED state set in the meantime is never overwritten back to NOTIFIED.
    await this.prisma.customerVersionState.updateMany({
      where: { id, notifiedAt: null, state: 'PENDING_NOTIFICATION' },
      data: {
        state: update.state,
        notifiedAt: update.notifiedAt ?? null,
        deadlineAt: update.deadlineAt ?? null,
      },
    });
    const stored = await this.prisma.customerVersionState.findUnique({ where: { id } });
    if (!stored) {
      throw new DomainError('INVALID_STATE', `CustomerVersionState ${id} does not exist`);
    }
    return toDomain(stored);
  }

  async transition(
    id: string,
    expectedState: CustomerVersionState['state'],
    update: CustomerVersionStateTransition,
  ): Promise<CustomerVersionState | null> {
    // Conditional transition: UPDATE … WHERE id = $1 AND state = $2 — atomicity guaranteed by
    // Postgres; count=0 means the precondition was not met (or the id is unknown) → null.
    const { count } = await this.prisma.customerVersionState.updateMany({
      where: { id, state: expectedState },
      data: {
        state: update.state,
        ...(update.remindersSent !== undefined ? { remindersSent: update.remindersSent } : {}),
      },
    });
    if (count === 0) {
      return null;
    }
    const stored = await this.prisma.customerVersionState.findUnique({ where: { id } });
    return stored ? toDomain(stored) : null;
  }
}

import type { CustomerVersionState as PrismaCustomerVersionState } from '@prisma/client';
import type { CustomerVersionState } from '../../../domain/types';
import { nullToUndefined } from './null';

/**
 * Prisma row → domain type. `lastReminderAt` is a persistence-only field with no domain
 * counterpart (reminder job idempotency, see docs/PERSISTENCE.md "Deviations") and is
 * deliberately not mapped here — the domain layer only knows `remindersSent`.
 */
export const toDomain = (row: PrismaCustomerVersionState): CustomerVersionState => ({
  id: row.id,
  customerId: row.customerId,
  versionId: row.versionId,
  state: row.state,
  notifiedAt: nullToUndefined(row.notifiedAt),
  deadlineAt: nullToUndefined(row.deadlineAt),
  remindersSent: row.remindersSent,
  carryOverBlocking: row.carryOverBlocking,
});

/** Domain type → Prisma create/update data (lastReminderAt remains untouched, see above). */
export const toUpsertData = (
  state: CustomerVersionState,
): {
  customerId: string;
  versionId: string;
  state: CustomerVersionState['state'];
  notifiedAt: Date | null;
  deadlineAt: Date | null;
  remindersSent: number;
  carryOverBlocking: boolean;
} => ({
  customerId: state.customerId,
  versionId: state.versionId,
  state: state.state,
  notifiedAt: state.notifiedAt ?? null,
  deadlineAt: state.deadlineAt ?? null,
  remindersSent: state.remindersSent,
  carryOverBlocking: state.carryOverBlocking ?? false,
});

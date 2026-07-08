import type { Customer as PrismaCustomer } from '@prisma/client';
import type { Customer } from '../../../domain/types';

/** Prisma row → domain type (createdAt/updatedAt are infrastructure-only fields). */
export const toDomain = (row: PrismaCustomer): Customer => ({
  id: row.id,
  externalRef: row.externalRef,
  name: row.name,
  roles: row.roles,
  contactEmails: row.contactEmails,
});

/** Domain type → Prisma create/update data. */
export const toUpsertData = (
  customer: Customer,
): { externalRef: string; name: string; roles: string[]; contactEmails: string[] } => ({
  externalRef: customer.externalRef,
  name: customer.name ?? '',
  roles: customer.roles,
  contactEmails: customer.contactEmails,
});

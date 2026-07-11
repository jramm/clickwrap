import type { Customer as PrismaCustomer } from '@prisma/client';
import type { Customer } from '../../../domain/types.js';
import { nullToUndefined } from './null.js';

/** Prisma row → domain type (createdAt/updatedAt are infrastructure-only fields). */
export const toDomain = (row: PrismaCustomer): Customer => ({
  id: row.id,
  externalRef: row.externalRef,
  firstName: row.firstName,
  lastName: row.lastName,
  companyName: row.companyName ?? undefined,
  roles: row.roles,
  contactEmails: row.contactEmails,
  source: nullToUndefined(row.source),
  deletedAt: nullToUndefined(row.deletedAt),
});

/** Domain type → Prisma create/update data. */
export const toUpsertData = (
  customer: Customer,
): {
  externalRef: string;
  firstName: string;
  lastName: string;
  companyName: string | null;
  roles: string[];
  contactEmails: string[];
  source: string | null;
  deletedAt: Date | null;
} => ({
  externalRef: customer.externalRef,
  firstName: customer.firstName ?? '',
  lastName: customer.lastName ?? '',
  companyName: customer.companyName ?? null,
  roles: customer.roles,
  contactEmails: customer.contactEmails,
  source: customer.source ?? null,
  deletedAt: customer.deletedAt ?? null,
});

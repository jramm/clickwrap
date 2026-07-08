/**
 * Pure customer helpers (no Nest/Prisma imports; CONVENTIONS: domain is pure).
 */
import type { Customer } from './types';

/**
 * The single human-readable label for a customer, used everywhere a customer is shown as one
 * string (admin overview/dashboard rows, per-version customer list, history, and the e-mail
 * `{{customerName}}` placeholder): the `companyName` when set, otherwise the contact person's
 * `` `${firstName} ${lastName}` `` (trimmed). Returns '' when neither is known.
 */
export const customerDisplayName = (
  customer: Pick<Customer, 'firstName' | 'lastName' | 'companyName'>,
): string => {
  const company = customer.companyName?.trim() ?? '';
  if (company !== '') {
    return company;
  }
  return `${customer.firstName} ${customer.lastName}`.trim();
};

import type { Customer } from '../domain/types';

/**
 * Case-insensitive substring match used by the admin customer list and the overview `search`
 * query param. A customer matches when the (trimmed, lower-cased) term is a substring of its
 * `firstName`, `lastName`, `companyName`, its `externalRef` or ANY of its `contactEmails`. An
 * empty/whitespace term matches everything (the caller then skips filtering).
 *
 * Kept as a pure helper so the admin list and the overview apply IDENTICAL semantics, and so the
 * in-memory and Prisma code paths cannot drift: both services already materialise the full
 * customer set (findAll) and filter in application code — see CustomerAdminService.list.
 */
export function matchesCustomerSearch(customer: Customer, term: string): boolean {
  const needle = term.trim().toLowerCase();
  if (needle === '') {
    return true;
  }
  const haystacks = [
    customer.firstName ?? '',
    customer.lastName ?? '',
    customer.companyName ?? '',
    customer.externalRef,
    ...customer.contactEmails,
  ];
  return haystacks.some((value) => value.toLowerCase().includes(needle));
}

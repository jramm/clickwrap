import type { Customer } from '../domain/types';

/**
 * Case-insensitive substring match used by the admin customer list `search` query param. A customer
 * matches when the (trimmed, lower-cased) term is a substring of its `firstName`, `lastName`,
 * `companyName`, its `externalRef` or ANY of its `contactEmails`. An empty/whitespace term matches
 * everything (the caller then skips filtering).
 *
 * Kept as a pure helper so the in-memory and Prisma code paths cannot drift: the service already
 * materialises the full customer set (findAll) and filters in application code — see
 * CustomerAdminService.list.
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

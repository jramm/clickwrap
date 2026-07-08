/**
 * Derived customer display label — mirrors the backend helper
 * (src/domain/customer.ts::customerDisplayName): the companyName when set, otherwise the contact
 * person's `${firstName} ${lastName}` (trimmed). Returns '' when neither is known.
 */
interface CustomerNameParts {
  firstName?: string;
  lastName?: string;
  companyName?: string;
}

export const customerDisplayName = (customer: CustomerNameParts): string => {
  const company = customer.companyName?.trim() ?? '';
  if (company !== '') {
    return company;
  }
  return `${customer.firstName ?? ''} ${customer.lastName ?? ''}`.trim();
};

import { aCustomer } from '../domain/testing/fixtures';
import { matchesCustomerSearch } from './customer-search';

describe('matchesCustomerSearch', () => {
  const customer = aCustomer({
    firstName: 'Jane',
    lastName: 'Doe',
    companyName: 'Acme GmbH',
    externalRef: 'crm-4711',
    contactEmails: ['legal@acme.example', 'ops@acme.example'],
  });

  it('matches a case-insensitive substring of the company name', () => {
    expect(matchesCustomerSearch(customer, 'acme')).toBe(true);
    expect(matchesCustomerSearch(customer, 'ME GMB')).toBe(true);
  });

  it('matches a substring of the contact person first/last name', () => {
    expect(matchesCustomerSearch(customer, 'jane')).toBe(true);
    expect(matchesCustomerSearch(customer, 'DOE')).toBe(true);
  });

  it('matches a substring of the externalRef', () => {
    expect(matchesCustomerSearch(customer, '4711')).toBe(true);
    expect(matchesCustomerSearch(customer, 'CRM-')).toBe(true);
  });

  it('matches a substring of any contact e-mail', () => {
    expect(matchesCustomerSearch(customer, 'ops@')).toBe(true);
    expect(matchesCustomerSearch(customer, 'ACME.EXAMPLE')).toBe(true);
  });

  it('does not match an unrelated term', () => {
    expect(matchesCustomerSearch(customer, 'zzz')).toBe(false);
  });

  it('an empty or whitespace term matches everything', () => {
    expect(matchesCustomerSearch(customer, '')).toBe(true);
    expect(matchesCustomerSearch(customer, '   ')).toBe(true);
  });

  it('tolerates a missing name', () => {
    const noName = aCustomer({ firstName: '', lastName: '', companyName: undefined, externalRef: 'ref-1', contactEmails: [] });
    expect(matchesCustomerSearch(noName, 'ref')).toBe(true);
    expect(matchesCustomerSearch(noName, 'acme')).toBe(false);
  });
});

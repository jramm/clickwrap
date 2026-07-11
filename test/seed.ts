/** Seed helpers for boot/smoke tests: create master data directly via the domain ports. */
import type { INestApplication } from '@nestjs/common';
import type { AudienceRepo, CustomerRepo, DocumentTypeRepo } from '../src/domain/ports.js';
import type { Audience, Customer, DocumentTypeDef } from '../src/domain/types.js';
import { TOKENS } from '../src/persistence/tokens.js';

/** Audience entity ("customer", "partner", ...) — documents and roles reference its key. */
export const seedAudience = async (
  app: INestApplication,
  overrides: Partial<Audience> = {},
): Promise<Audience> => {
  const audiences = app.get<AudienceRepo>(TOKENS.AudienceRepo);
  return audiences.save({
    id: 'aud-boot-customer',
    key: 'customer',
    name: 'Customers',
    ...overrides,
  });
};

/** Document type entity ("terms", "dpa", ...) — documents reference its key. */
export const seedDocumentType = async (
  app: INestApplication,
  overrides: Partial<DocumentTypeDef> = {},
): Promise<DocumentTypeDef> => {
  const documentTypes = app.get<DocumentTypeRepo>(TOKENS.DocumentTypeRepo);
  return documentTypes.save({
    id: 'dt-boot-dpa',
    key: 'dpa',
    name: 'Data Processing Agreement',
    ...overrides,
  });
};

/** The standard pair of audiences ("customer", "partner") used across example/smoke setups. */
export const seedAudiences = async (app: INestApplication): Promise<Audience[]> => {
  return Promise.all([
    seedAudience(app, { id: 'aud-example-customer', key: 'customer', name: 'Customers' }),
    seedAudience(app, { id: 'aud-example-partner', key: 'partner', name: 'Partners' }),
  ]);
};

/** The standard pair of document types ("terms", "dpa") used across example/smoke setups. */
export const seedDocumentTypes = async (app: INestApplication): Promise<DocumentTypeDef[]> => {
  return Promise.all([
    seedDocumentType(app, { id: 'dt-example-terms', key: 'terms', name: 'Terms of Service' }),
    seedDocumentType(app, { id: 'dt-example-dpa', key: 'dpa', name: 'Data Processing Agreement' }),
  ]);
};

/** Customer with a role (audience key) + contact e-mails (rollout target). */
export const seedCustomer = async (
  app: INestApplication,
  overrides: Partial<Customer> = {},
): Promise<Customer> => {
  const customers = app.get<CustomerRepo>(TOKENS.CustomerRepo);
  return customers.save({
    id: 'c-boot-1',
    externalRef: 'company-boot-1',
    firstName: 'Jane',
    lastName: 'Doe',
    companyName: 'Boot Company',
    roles: ['customer'],
    contactEmails: ['legal@customer.example'],
    ...overrides,
  });
};

/** Test builders for domain specs (import from *.spec.ts only). */
import type { Actor } from '../../common/auth/actor';
import type {
  Acceptance,
  AcceptanceLink,
  AgreementDocument,
  AgreementVersion,
  Audience,
  Customer,
  CustomerVersionState,
  DocumentTypeDef,
  NotificationEvent,
  Objection,
  SignedDocument,
} from '../types';

export const testActor = (overrides: Partial<Actor> = {}): Actor => ({
  userId: 'u-42',
  name: 'Jane Doe',
  email: 'jane@customer.example',
  portalRole: 'admin',
  ...overrides,
});

export const anAudience = (overrides: Partial<Audience> = {}): Audience => ({
  id: 'aud-customer',
  key: 'customer',
  name: 'Customers',
  ...overrides,
});

export const aDocumentTypeDef = (overrides: Partial<DocumentTypeDef> = {}): DocumentTypeDef => ({
  id: 'dt-dpa',
  key: 'dpa',
  name: 'Data Processing Agreement',
  // Real boolean by default — matches how the admin service creates types (external: input === true)
  // and how the Prisma column (@default(false)) round-trips, so in-memory and Prisma repos agree.
  external: false,
  ...overrides,
});

export const aDocument = (overrides: Partial<AgreementDocument> = {}): AgreementDocument => ({
  id: 'doc-dpa-customer',
  type: 'dpa',
  audience: 'customer',
  name: 'DPA — Customers',
  ...overrides,
});

export const aVersion = (overrides: Partial<AgreementVersion> = {}): AgreementVersion => ({
  id: 'v-1',
  documentId: 'doc-dpa-customer',
  versionLabel: 'June 2026 edition',
  status: 'PUBLISHED',
  acceptanceMode: 'PASSIVE',
  objectionPeriodDays: 14,
  changeSummary: 'New sub-processor for e-mail delivery.',
  storageKey: 's3://bucket/v-1.pdf',
  fileName: 'dpa-2026-06.pdf',
  contentHash: 'sha256:9c1e',
  fileSize: 1024,
  validFrom: new Date('2026-07-01T00:00:00Z'),
  publishedAt: new Date('2026-07-01T09:00:00Z'),
  publishedBy: 'admin-1',
  ...overrides,
});

export const anActiveVersion = (overrides: Partial<AgreementVersion> = {}): AgreementVersion =>
  aVersion({
    acceptanceMode: 'ACTIVE',
    objectionPeriodDays: undefined,
    gracePeriodDays: 14,
    consentText: 'I have read the new revision and agree.',
    ...overrides,
  });

export const aCustomer = (overrides: Partial<Customer> = {}): Customer => ({
  id: 'c-123',
  externalRef: 'company-123',
  firstName: 'Jane',
  lastName: 'Doe',
  companyName: 'Acme GmbH',
  roles: ['customer'],
  contactEmails: ['jane@customer.example'],
  ...overrides,
});

export const aState = (overrides: Partial<CustomerVersionState> = {}): CustomerVersionState => ({
  id: 'cvs-1',
  customerId: 'c-123',
  versionId: 'v-1',
  state: 'PENDING_NOTIFICATION',
  remindersSent: 0,
  ...overrides,
});

export const anAcceptance = (overrides: Partial<Acceptance> = {}): Acceptance => ({
  id: 'a-1',
  customerId: 'c-123',
  versionId: 'v-1',
  method: 'ACTIVE_CONSENT',
  channel: 'PORTAL',
  acceptedAt: new Date('2026-07-09T14:12:03Z'),
  actor: testActor(),
  isEffective: true,
  ...overrides,
});

export const anObjection = (overrides: Partial<Objection> = {}): Objection => ({
  id: 'o-1',
  customerId: 'c-123',
  versionId: 'v-1',
  objectedAt: new Date('2026-07-10T10:00:00Z'),
  actor: testActor(),
  reason: 'Sub-processor XY is not acceptable.',
  channel: 'PORTAL',
  ...overrides,
});

export const anAcceptanceLink = (overrides: Partial<AcceptanceLink> = {}): AcceptanceLink => ({
  id: 'al-1',
  tokenHash: 'a'.repeat(64),
  customerId: 'c-123',
  kind: 'STANDARD',
  createdBy: 'admin-1',
  createdAt: new Date('2026-07-01T09:00:00Z'),
  expiresAt: new Date('2026-07-31T09:00:00Z'),
  ...overrides,
});

export const aSignedDocument = (overrides: Partial<SignedDocument> = {}): SignedDocument => ({
  id: 'sd-1',
  customerId: 'c-123',
  documentTypeKey: 'signed-offer',
  audience: 'customer',
  fileName: 'signed-offer.pdf',
  storageKey: 's3://bucket/sd-1.pdf',
  contentHash: 'sha256:deadbeef',
  fileSize: 2048,
  signedAt: new Date('2026-06-15T00:00:00Z'),
  signerName: 'Jane Doe',
  reference: 'HubSpot deal 12345',
  note: 'Counter-signed offer.',
  uploadedBy: 'admin-1',
  uploadedAt: new Date('2026-07-01T09:00:00Z'),
  ...overrides,
});

export const aNotification = (overrides: Partial<NotificationEvent> = {}): NotificationEvent => ({
  id: 'n-1',
  customerVersionStateId: 'cvs-1',
  channel: 'EMAIL',
  recipient: 'jane@customer.example',
  occurredAt: new Date('2026-07-07T09:05:11Z'),
  providerRef: 'pm-message-1',
  ...overrides,
});

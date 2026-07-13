import { HttpResponse, http } from 'msw';
import { z } from 'zod';
import {
  createAcceptanceLinkResponseModelSchema,
  createCustomerResponseModelSchema,
  customerHistoryResponseModelSchema,
  customerListResponseModelSchema,
  customerRowModelSchema,
  dashboardResponseModelSchema,
  documentListResponseModelSchema,
  documentTypeModelSchema,
  emailTemplateModelSchema,
  eventListResponseModelSchema,
  emailTemplatePreviewResponseModelSchema,
  namedEntityModelSchema,
  publishResponseModelSchema,
  signedDocumentListResponseModelSchema,
  versionCustomersResponseModelSchema,
  versionListResponseModelSchema,
  versionModelSchema,
} from '../gen';

/**
 * Default MSW handlers with realistic fixtures for the admin endpoints. Every
 * fixture is validated against the generated zod schema (src/gen) at module load
 * so the mocks can never drift from the backend contract again — a mismatch
 * throws here instead of masking bugs (the core lesson from the migration).
 */
const BASE = 'http://localhost:3000';

export const audiencesFixture = z.array(namedEntityModelSchema).parse([
  { id: 'aud-op', key: 'operator', name: 'Operator' },
  { id: 'aud-pt', key: 'partner', name: 'Partner' },
]);

export const documentTypesFixture = z.array(documentTypeModelSchema).parse([
  { id: 'dt-terms', key: 'terms', name: 'Terms of Service', external: false },
  {
    id: 'dt-dpa',
    key: 'dpa',
    name: 'Data Processing Agreement',
    external: false,
    notificationTemplateId: 'tpl-default-notification',
  },
  { id: 'dt-offer', key: 'signed-offer', name: 'Signed offer', external: true },
]);

export const emailTemplatesFixture = z.array(emailTemplateModelSchema).parse([
  {
    id: 'tpl-default-notification',
    name: 'Default — version notification',
    kind: 'VERSION_NOTIFICATION',
    subject: '{{appName}}: new version of {{documentName}}',
    design: '{}',
    html: '<p>Hi {{customerName}}</p>',
    isDefault: true,
    createdAt: '2026-07-01T00:00:00Z',
    updatedAt: '2026-07-01T00:00:00Z',
  },
  {
    id: 'tpl-default-reminder',
    name: 'Default — reminder',
    kind: 'REMINDER',
    subject: 'Reminder: {{documentName}}',
    design: '{}',
    html: '<p>Reminder {{customerName}}</p>',
    isDefault: true,
    createdAt: '2026-07-01T00:00:00Z',
    updatedAt: '2026-07-01T00:00:00Z',
  },
  {
    id: 'tpl-default-acceptance-confirmation',
    name: 'Default — acceptance confirmation',
    kind: 'ACCEPTANCE_CONFIRMATION',
    subject: 'Your acceptance of {{documentName}}',
    design: '{}',
    html: '<p>Thank you {{customerName}}, accepted on {{acceptedAt}}</p>',
    isDefault: true,
    createdAt: '2026-07-01T00:00:00Z',
    updatedAt: '2026-07-01T00:00:00Z',
  },
  {
    id: 'tpl-custom',
    name: 'Friendly welcome',
    kind: 'VERSION_NOTIFICATION',
    subject: 'Welcome {{customerName}}',
    design: '{}',
    html: '<p>Welcome {{customerName}}</p>',
    isDefault: false,
    createdAt: '2026-07-02T00:00:00Z',
    updatedAt: '2026-07-02T00:00:00Z',
  },
]);

export const emailTemplatePreviewFixture = emailTemplatePreviewResponseModelSchema.parse({
  subject: 'clickwrap-server: new version of Data Processing Agreement — Customers',
  html: '<p>Hi Acme GmbH</p>',
  text: 'Hi Acme GmbH',
});

function makeVersion(overrides: Partial<z.input<typeof versionModelSchema>> = {}) {
  return versionModelSchema.parse({
    id: 'v-100',
    documentId: 'doc-dpa-op',
    versionLabel: 'April 2026 edition',
    status: 'PUBLISHED',
    acceptanceMode: 'ACTIVE',
    changeSummary: 'Initial edition.',
    validFrom: '2026-04-01T00:00:00Z',
    contentHash: 'sha256:9c1e',
    fileName: 'dpa-2026-04.pdf',
    pdfUrl: 'https://example.test/v-100.pdf',
    ...overrides,
  });
}

/** Future timestamp relative to the test run — powers the scheduled-publish fixtures. */
export const futureValidFromFixture = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

/** A second, farther future timestamp — for the multiple-scheduled-versions fixtures. */
export const farFutureValidFromFixture = new Date(Date.now() + 120 * 24 * 60 * 60 * 1000).toISOString();

export const documentsFixture = documentListResponseModelSchema.parse({
  items: [
    {
      id: 'doc-dpa-op',
      type: 'dpa',
      audience: 'operator',
      name: 'Data Processing Agreement — Operator',
      currentVersion: makeVersion({ id: 'v-100', documentId: 'doc-dpa-op' }),
      // Scheduled publish: TWO newer PUBLISHED versions that become effective in the future
      // (ordered by validFrom asc) — several futures may be scheduled at once.
      upcomingVersions: [
        makeVersion({
          id: 'v-300',
          documentId: 'doc-dpa-op',
          versionLabel: 'September 2026 edition',
          validFrom: futureValidFromFixture,
          fileName: 'dpa-2026-09.pdf',
          pdfUrl: 'https://example.test/v-300.pdf',
        }),
        makeVersion({
          id: 'v-400',
          documentId: 'doc-dpa-op',
          versionLabel: 'December 2026 edition',
          validFrom: farFutureValidFromFixture,
          fileName: 'dpa-2026-12.pdf',
          pdfUrl: 'https://example.test/v-400.pdf',
        }),
      ],
      latestPdfUrl: 'https://clickwrap.example.org/documents/dpa/operator/latest.pdf',
    },
    {
      id: 'doc-terms-op',
      type: 'terms',
      audience: 'operator',
      name: 'Terms of Service — Operator',
      currentVersion: makeVersion({
        id: 'v-050',
        documentId: 'doc-terms-op',
        fileName: 'tos-2026-04.pdf',
        pdfUrl: 'https://example.test/v-050.pdf',
      }),
      upcomingVersions: [],
      latestPdfUrl: 'https://clickwrap.example.org/documents/terms/operator/latest.pdf',
    },
    {
      id: 'doc-terms-pt',
      type: 'terms',
      audience: 'partner',
      name: 'Terms of Service — Partner',
      currentVersion: null,
      upcomingVersions: [],
      latestPdfUrl: null,
    },
    {
      id: 'doc-dpa-pt',
      type: 'dpa',
      audience: 'partner',
      name: 'Data Processing Agreement — Partner',
      currentVersion: null,
      upcomingVersions: [],
      latestPdfUrl: null,
    },
  ],
});

export const versionsFixture = versionListResponseModelSchema.parse({
  items: [
    makeVersion({ id: 'v-100', documentId: 'doc-dpa-op' }),
    makeVersion({
      id: 'v-200',
      documentId: 'doc-dpa-op',
      versionLabel: 'June 2026 edition',
      status: 'DRAFT',
      validFrom: '2026-06-01T00:00:00Z',
      publishedAt: undefined,
    }),
    // DRAFT with a FUTURE validFrom — the publish dialog announces scheduled effectiveness.
    makeVersion({
      id: 'v-400',
      documentId: 'doc-dpa-op',
      versionLabel: 'October 2026 edition',
      status: 'DRAFT',
      validFrom: futureValidFromFixture,
      publishedAt: undefined,
    }),
  ],
});

export const historyFixture = customerHistoryResponseModelSchema.parse({
  acceptances: [
    {
      versionId: 'v-7f3a',
      documentType: 'dpa',
      versionLabel: 'June 2026 edition',
      method: 'IMPORT',
      channel: 'ADMIN',
      acceptedAt: '2026-07-09T14:12:03Z',
      actor: { userId: 'u-42', name: 'Jane Doe', email: 'jane.doe@customer.test' },
      isEffective: true,
      evidence: {
        ipAddress: '203.0.113.7',
        userAgent: 'Mozilla/5.0',
        consentText: 'I agree.',
        consentTextHash: 'sha256:ab12',
        contentHash: 'sha256:9c1e',
        evidenceNote: 'HubSpot deal 12345 / signed offer',
      },
    },
  ],
  objections: [],
  notifications: [{ versionId: 'v-7f3a', channel: 'EMAIL', deliveredAt: '2026-07-07T09:05:11Z' }],
  signedDocuments: [
    {
      id: 'sd-1',
      documentTypeKey: 'signed-offer',
      audience: 'operator',
      fileName: 'signed-offer.pdf',
      contentHash: 'sha256:deadbeef',
      fileSize: 20480,
      signedAt: '2026-06-15T00:00:00Z',
      signerName: 'Jane Doe',
      reference: 'HubSpot deal 12345',
      uploadedBy: 'u-42',
      uploadedAt: '2026-07-01T09:00:00Z',
    },
  ],
  states: [
    {
      id: 'cvs-1',
      versionId: 'v-7f3a',
      documentType: 'dpa',
      versionLabel: 'June 2026 edition',
      state: 'EXPIRED_BLOCKING',
      deadlineAt: '2026-06-30T00:00:00Z',
      remindersSent: 1,
      carryOverBlocking: true,
    },
  ],
});

export const customersFixture = customerListResponseModelSchema.parse({
  items: [
    {
      id: 'c-123',
      externalRef: 'crm-4711',
      firstName: 'Jane',
      lastName: 'Doe',
      companyName: 'Example Utility Ltd',
      roles: ['operator'],
      contactEmails: ['legal@example.test'],
      compliant: false,
      complianceStatus: 'blocked',
    },
  ],
  total: 1,
});

/** Single-customer read (detail-page header) — mirrors the c-123 list row. */
export const customerFixture = customerRowModelSchema.parse({
  id: 'c-123',
  externalRef: 'crm-4711',
  firstName: 'Jane',
  lastName: 'Doe',
  companyName: 'Example Utility Ltd',
  roles: ['operator'],
  contactEmails: ['legal@example.test'],
});

export const dashboardFixture = dashboardResponseModelSchema.parse({
  items: [
    {
      versionId: 'v-100',
      documentName: 'Data Processing Agreement — Operator',
      documentType: 'dpa',
      audience: 'operator',
      versionLabel: 'April 2026 edition',
      status: 'PUBLISHED',
      validFrom: '2026-04-01T00:00:00Z',
      upcoming: false,
      stats: {
        totalCustomers: 8,
        accepted: 4,
        acceptedByChannel: { PORTAL: 2, LINK: 1, ADMIN: 1, SYSTEM: 0 },
        acceptedByMethod: { ACTIVE_CONSENT: 3, TACIT: 0, IMPORT: 1 },
        pending: 2,
        blocked: 1,
        objected: 1,
        acceptanceRate: 0.5,
      },
    },
    {
      versionId: 'v-300',
      documentName: 'Data Processing Agreement — Operator',
      documentType: 'dpa',
      audience: 'operator',
      versionLabel: 'September 2026 edition',
      status: 'PUBLISHED',
      validFrom: futureValidFromFixture,
      upcoming: true,
      stats: {
        totalCustomers: 8,
        accepted: 0,
        acceptedByChannel: { PORTAL: 0, LINK: 0, ADMIN: 0, SYSTEM: 0 },
        acceptedByMethod: { ACTIVE_CONSENT: 0, TACIT: 0, IMPORT: 0 },
        pending: 8,
        blocked: 0,
        objected: 0,
        acceptanceRate: 0,
      },
    },
  ],
});

const dashboardByVersion = new Map(dashboardFixture.items.map((item) => [item.versionId, item]));

/**
 * Per-version customer lists. The SAME customer (c-123) is ACCEPTED on the current version (v-100)
 * but only PENDING on the upcoming one (v-300) — the exact drill-down bug the feature fixes. Stats
 * are reused from the dashboard fixture so the page header matches the dashboard card.
 */
export const versionCustomersByVersion = {
  'v-100': versionCustomersResponseModelSchema.parse({
    items: [
      {
        customerId: 'c-123',
        customerName: 'Example Utility Ltd',
        externalRef: 'crm-4711',
        state: 'ACCEPTED',
        acceptance: {
          acceptedAt: '2026-04-05T10:00:00Z',
          method: 'ACTIVE_CONSENT',
          channel: 'PORTAL',
          actorName: 'Jane Doe',
        },
      },
      {
        customerId: 'c-999',
        customerName: 'Sample Energy Inc',
        externalRef: 'crm-8000',
        state: 'NOTIFIED',
        notifiedAt: '2026-04-02T00:00:00Z',
        deadlineAt: '2026-07-21T00:00:00Z',
      },
    ],
    total: 2,
    stats: dashboardByVersion.get('v-100') ?? dashboardFixture.items[0],
  }),
  'v-300': versionCustomersResponseModelSchema.parse({
    items: [
      {
        customerId: 'c-123',
        customerName: 'Example Utility Ltd',
        externalRef: 'crm-4711',
        state: 'PENDING_NOTIFICATION',
      },
    ],
    total: 1,
    stats: dashboardByVersion.get('v-300') ?? dashboardFixture.items[1],
  }),
} as const;

export const versionCustomersFixture = versionCustomersByVersion['v-100'];

export const signedDocumentsFixture = signedDocumentListResponseModelSchema.parse({
  items: [
    {
      id: 'sd-1',
      customerId: 'c-123',
      documentTypeKey: 'signed-offer',
      audience: 'operator',
      fileName: 'signed-offer.pdf',
      contentHash: 'sha256:deadbeef',
      fileSize: 20480,
      signedAt: '2026-06-15T00:00:00Z',
      signerName: 'Jane Doe',
      reference: 'HubSpot deal 12345',
      uploadedBy: 'u-42',
      uploadedAt: '2026-07-01T09:00:00Z',
      pdfUrl: 'https://example.test/sd-1.pdf',
    },
  ],
});

export const publishFixture = publishResponseModelSchema.parse({
  versionId: 'v-200',
  status: 'PUBLISHED',
  rolloutCustomers: 921,
  publishedAt: '2026-07-07T09:00:00Z',
});

export const createdCustomerFixture = createCustomerResponseModelSchema.parse({
  id: 'c-new',
  externalRef: 'crm-9000',
  firstName: '',
  lastName: '',
  companyName: 'New Co',
  roles: ['operator'],
  contactEmails: ['ops@new.test'],
  importedAcceptances: [],
});

export const acceptanceLinkFixture = createAcceptanceLinkResponseModelSchema.parse({
  linkId: 'al-1',
  url: 'https://clickwrap.example.org/accept/test-token-abc',
  expiresAt: '2026-08-07T09:00:00Z',
});

export const eventsFixture = eventListResponseModelSchema.parse({
  items: [
    {
      id: 'obj:o-1',
      occurredAt: '2026-07-10T10:00:00.000Z',
      type: 'OBJECTION_RAISED',
      category: 'CONSENT',
      actorKind: 'CUSTOMER',
      actorLabel: 'Jane Doe',
      customerId: 'c-123',
      customerName: 'Example Utility Ltd',
      versionId: 'v-100',
      documentType: 'dpa',
      versionLabel: 'April 2026 edition',
      summary: 'Objection raised against version April 2026 edition',
    },
    {
      id: 'acc:a-1',
      occurredAt: '2026-07-09T14:12:03.000Z',
      type: 'VERSION_ACCEPTED',
      category: 'CONSENT',
      actorKind: 'CUSTOMER',
      actorLabel: 'Jane Doe',
      customerId: 'c-123',
      customerName: 'Example Utility Ltd',
      versionId: 'v-100',
      documentType: 'dpa',
      versionLabel: 'April 2026 edition',
      channel: 'PORTAL',
      summary: 'Version April 2026 edition accepted (ACTIVE_CONSENT, PORTAL)',
    },
    {
      id: 'notif:n-1',
      occurredAt: '2026-07-07T09:05:11.000Z',
      type: 'EMAIL_SENT',
      category: 'COMMUNICATION',
      actorKind: 'SYSTEM',
      actorLabel: 'system',
      customerId: 'c-123',
      customerName: 'Example Utility Ltd',
      versionId: 'v-100',
      documentType: 'dpa',
      channel: 'EMAIL',
      recipient: 'legal@example.test',
      summary: 'E-mail sent to legal@example.test (version April 2026 edition)',
    },
    {
      id: 'audit:au-pub',
      occurredAt: '2026-07-01T09:00:00.000Z',
      type: 'VERSION_PUBLISHED',
      category: 'ADMINISTRATION',
      actorKind: 'ADMIN',
      actorLabel: 'admin-1',
      versionId: 'v-100',
      documentType: 'dpa',
      versionLabel: 'April 2026 edition',
      summary: 'Version April 2026 edition published',
    },
  ],
  total: 4,
});

export const authMethodsFixture = {
  methods: [
    { key: 'google', flow: 'google', label: 'Google', params: { clientId: 'test-client-id' } },
    { key: 'token', flow: 'token', label: 'Developer token', params: {} },
  ],
};

const VERSION_CUSTOMER_STATE_FILTER: Record<string, string[]> = {
  accepted: ['ACCEPTED'],
  pending: ['PENDING_NOTIFICATION', 'NOTIFIED'],
  blocked: ['EXPIRED_BLOCKING'],
  objected: ['OBJECTED'],
};

function matchesVersionCustomerState(state: string, filter: string): boolean {
  return (VERSION_CUSTOMER_STATE_FILTER[filter] ?? []).includes(state);
}

export const handlers = [
  http.get(`${BASE}/admin/auth/methods`, () => HttpResponse.json(authMethodsFixture)),
  http.get(`${BASE}/admin/audiences`, () => HttpResponse.json(audiencesFixture)),
  http.get(`${BASE}/admin/document-types`, () => HttpResponse.json(documentTypesFixture)),
  http.get(`${BASE}/admin/dashboard`, () => HttpResponse.json(dashboardFixture)),
  http.get(`${BASE}/admin/versions/:id/customers`, ({ params, request }) => {
    const byVersion = versionCustomersByVersion as Record<string, typeof versionCustomersFixture>;
    const body = byVersion[String(params.id)] ?? versionCustomersByVersion['v-100'];
    const state = new URL(request.url).searchParams.get('state');
    const items = state ? body.items.filter((row) => matchesVersionCustomerState(row.state, state)) : body.items;
    return HttpResponse.json(versionCustomersResponseModelSchema.parse({ ...body, items, total: items.length }));
  }),
  http.get(`${BASE}/admin/documents`, () => HttpResponse.json(documentsFixture)),
  http.get(`${BASE}/admin/documents/:id/versions`, () => HttpResponse.json(versionsFixture)),
  http.get(`${BASE}/admin/versions/:id`, ({ params }) =>
    HttpResponse.json(makeVersion({ id: params.id as string, documentId: 'doc-dpa-op' })),
  ),
  http.get(`${BASE}/admin/customers`, () => HttpResponse.json(customersFixture)),
  http.get(`${BASE}/admin/events`, () => HttpResponse.json(eventsFixture)),
  http.get(`${BASE}/admin/customers/:id/history`, () => HttpResponse.json(historyFixture)),
  http.get(`${BASE}/admin/customers/:id/signed-documents`, () => HttpResponse.json(signedDocumentsFixture)),
  http.post(`${BASE}/admin/customers/:id/signed-documents`, () =>
    HttpResponse.json(signedDocumentsFixture.items[0], { status: 201 }),
  ),
  http.get(`${BASE}/admin/customers/:id`, () => HttpResponse.json(customerFixture)),
  http.post(`${BASE}/admin/customers`, () => HttpResponse.json(createdCustomerFixture, { status: 201 })),
  http.get(`${BASE}/admin/versions/:id/affected-customers`, () =>
    HttpResponse.json({ audience: 'operator', count: 921 }),
  ),
  http.post(`${BASE}/admin/versions/:id/publish`, () => HttpResponse.json(publishFixture, { status: 201 })),
  http.post(`${BASE}/admin/customers/:id/acceptance-links`, () =>
    HttpResponse.json(acceptanceLinkFixture, { status: 201 }),
  ),
  http.get(`${BASE}/admin/email-templates`, () => HttpResponse.json(emailTemplatesFixture)),
  http.post(`${BASE}/admin/email-templates`, async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    return HttpResponse.json(
      emailTemplateModelSchema.parse({
        id: 'tpl-new',
        name: String(body.name ?? 'New'),
        kind: String(body.kind ?? 'VERSION_NOTIFICATION'),
        subject: String(body.subject ?? ''),
        design: String(body.design ?? '{}'),
        html: String(body.html ?? ''),
        isDefault: false,
        createdAt: '2026-07-03T00:00:00Z',
        updatedAt: '2026-07-03T00:00:00Z',
      }),
      { status: 201 },
    );
  }),
  http.patch(`${BASE}/admin/email-templates/:id`, async ({ params, request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    return HttpResponse.json(
      emailTemplateModelSchema.parse({
        id: String(params.id),
        name: String(body.name ?? 'Edited'),
        kind: String(body.kind ?? 'VERSION_NOTIFICATION'),
        subject: String(body.subject ?? ''),
        design: String(body.design ?? '{}'),
        html: String(body.html ?? ''),
        isDefault: false,
        createdAt: '2026-07-03T00:00:00Z',
        updatedAt: '2026-07-04T00:00:00Z',
      }),
    );
  }),
  http.delete(`${BASE}/admin/email-templates/:id`, () => new HttpResponse(null, { status: 204 })),
  http.post(`${BASE}/admin/email-templates/:id/preview`, () =>
    HttpResponse.json(emailTemplatePreviewFixture),
  ),
  http.patch(`${BASE}/admin/document-types/:id`, async ({ params, request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    return HttpResponse.json(
      documentTypeModelSchema.parse({
        id: String(params.id),
        key: 'dpa',
        name: 'Data Processing Agreement',
        notificationTemplateId:
          body.notificationTemplateId === null ? undefined : (body.notificationTemplateId as string | undefined),
        reminderTemplateId:
          body.reminderTemplateId === null ? undefined : (body.reminderTemplateId as string | undefined),
        acceptanceConfirmationTemplateId:
          body.acceptanceConfirmationTemplateId === null
            ? undefined
            : (body.acceptanceConfirmationTemplateId as string | undefined),
      }),
    );
  }),
];

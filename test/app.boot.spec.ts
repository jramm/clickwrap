/**
 * Boot/smoke test: starts the complete AppModule with REPOSITORY_DRIVER=inmemory (no Postgres
 * needed) and exercises the mini walkthrough across all modules:
 *
 *   Admin creates document type + audience references via seeds, then document + ACTIVE version
 *   (multipart, consentText) → publish (rollout to the seeded customer with a matching role) →
 *   portal: pending-agreements shows the popup item → POST notifications (delivery evidence
 *   starts the deadline) → POST acceptances (active consent) → compliance gate reports
 *   compliant=true.
 *
 * This proves the wiring end-to-end (global RepositoryModule, PdfUrlProvider→PdfStorage,
 * RolloutNotifier→Postmark adapter with a noop client, guards, DomainErrorFilter).
 */
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

const ADMIN_TOKEN = 'boot-admin-token';
const SERVICE_TOKEN = 'boot-service-token';
const CONSENT_TEXT = 'I have read the new revision and agree.';
const CUSTOMER_ID = 'c-boot-1';

const adminHeaders = { 'x-admin-token': ADMIN_TOKEN, 'x-admin-user': 'admin-1' };
const portalHeaders = {
  'x-service-token': SERVICE_TOKEN,
  'x-customer-id': CUSTOMER_ID,
  'x-actor-user-id': 'u-42',
  'x-actor-name': 'Jane Doe',
  'x-actor-email': 'jane@customer.example',
  'x-actor-role': 'admin',
};

describe('AppModule boot (REPOSITORY_DRIVER=inmemory)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.REPOSITORY_DRIVER = 'inmemory';
    process.env.ADMIN_API_TOKEN = ADMIN_TOKEN;
    process.env.SERVICE_API_TOKEN = SERVICE_TOKEN;
    process.env.POSTMARK_API_TOKEN = ''; // noop client: no real sending in the boot test
    // Pin the file-storage driver so the presigned-URL assertion below is hermetic regardless of a
    // local .env (importing AppModule loads it; dotenv never overrides an already-set var).
    process.env.FILE_STORAGE = 'memory';

    // Dynamic import AFTER setting the env — RepositoryModule.forRoot() reads the driver
    // while the module metadata is evaluated.
    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('boots and answers the complete walkthrough admin → publish → portal → compliance', async () => {
    const http = () => request(app.getHttpServer());

    // 0) Auth is effective: 401 without a token.
    await http().get('/admin/documents').expect(401);
    await http().get(`/customers/${CUSTOMER_ID}/compliance`).expect(401);

    // 1) Dynamic entities exist (seeded) — creating a document validates against them.
    const { seedAudience, seedCustomer, seedDocumentType } = await import('./seed');
    await seedAudience(app); // key "customer"
    await seedDocumentType(app); // key "dpa"

    // Unknown keys are rejected with the dedicated 422 codes.
    const unknownTypeRes = await http()
      .post('/admin/documents')
      .set(adminHeaders)
      .send({ type: 'ghost', audience: 'customer', name: 'Ghost' })
      .expect(422);
    expect(unknownTypeRes.body).toMatchObject({ code: 'UNKNOWN_DOCUMENT_TYPE' });
    const unknownAudienceRes = await http()
      .post('/admin/documents')
      .set(adminHeaders)
      .send({ type: 'dpa', audience: 'ghost', name: 'Ghost' })
      .expect(422);
    expect(unknownAudienceRes.body).toMatchObject({ code: 'UNKNOWN_AUDIENCE' });

    // Admin creates the document.
    const documentRes = await http()
      .post('/admin/documents')
      .set(adminHeaders)
      .send({ type: 'dpa', audience: 'customer', name: 'DPA — Customers' })
      .expect(201);
    const documentId: string = documentRes.body.id;
    expect(documentId).toBeTruthy();

    // 2) ACTIVE version as a multipart upload including consentText.
    const versionRes = await http()
      .post(`/admin/documents/${documentId}/versions`)
      .set(adminHeaders)
      .field('versionLabel', 'June 2026 edition')
      .field('changeSummary', 'New sub-processor for e-mail delivery.')
      .field('acceptanceMode', 'ACTIVE')
      .field('consentText', CONSENT_TEXT)
      .field('gracePeriodDays', '14')
      .field('validFrom', '2026-01-01')
      .attach('file', Buffer.from('%PDF-1.7 boot-test'), 'dpa-2026-06.pdf')
      .expect(201);
    const versionId: string = versionRes.body.versionId;
    expect(versionRes.body).toMatchObject({ status: 'DRAFT', fileName: 'dpa-2026-06.pdf' });

    // 3) A customer with the role "customer" exists (seed helper) → publish rolls out to them.
    await seedCustomer(app, { id: CUSTOMER_ID });

    const publishRes = await http().post(`/admin/versions/${versionId}/publish`).set(adminHeaders).expect(201);
    expect(publishRes.body).toMatchObject({ versionId, status: 'PUBLISHED', rolloutCustomers: 1 });

    // 4) Portal popup: pending-agreements shows exactly this item.
    const pendingRes = await http()
      .get(`/customers/${CUSTOMER_ID}/pending-agreements?audience=customer`)
      .set(portalHeaders)
      .expect(200);
    expect(pendingRes.body).toHaveLength(1);
    expect(pendingRes.body[0]).toMatchObject({
      versionId,
      documentType: 'dpa',
      audience: 'customer',
      mode: 'ACTIVE',
      blocking: false,
    });
    // The PdfUrlProvider is bound to the PdfStorage — presigned URL with 15-minute TTL semantics.
    expect(pendingRes.body[0].pdfUrl).toContain('expires=900');

    // An unknown audience key on the portal endpoints → 422 UNKNOWN_AUDIENCE.
    const unknownPendingRes = await http()
      .get(`/customers/${CUSTOMER_ID}/pending-agreements?audience=ghost`)
      .set(portalHeaders)
      .expect(422);
    expect(unknownPendingRes.body).toMatchObject({ code: 'UNKNOWN_AUDIENCE' });

    // 5) Delivery evidence (popup shown) → NOTIFIED, deadline running (deadlineAt set).
    const notifyRes = await http()
      .post(`/customers/${CUSTOMER_ID}/notifications`)
      .set(portalHeaders)
      .send({ versionId, channel: 'PORTAL' })
      .expect(200);
    expect(notifyRes.body.state).toBe('NOTIFIED');
    expect(notifyRes.body.notifiedAt).toBeDefined();
    expect(notifyRes.body.deadlineAt).toBeDefined();

    // 6) Active consent from the popup (Idempotency-Key required).
    const acceptRes = await http()
      .post(`/customers/${CUSTOMER_ID}/acceptances`)
      .set(portalHeaders)
      .set('Idempotency-Key', 'boot-key-1')
      .send({ versionId, displayedConsentText: CONSENT_TEXT })
      .expect(201);
    expect(acceptRes.body).toEqual({ acceptanceId: expect.any(String), state: 'ACCEPTED' });

    // Replay with the same key → identical response (no error).
    const replayRes = await http()
      .post(`/customers/${CUSTOMER_ID}/acceptances`)
      .set(portalHeaders)
      .set('Idempotency-Key', 'boot-key-1')
      .send({ versionId, displayedConsentText: CONSENT_TEXT })
      .expect(201);
    expect(replayRes.body).toEqual(acceptRes.body);

    // 7) Nothing pending anymore: popup empty, compliance gate green.
    const pendingAfter = await http()
      .get(`/customers/${CUSTOMER_ID}/pending-agreements?audience=customer`)
      .set(portalHeaders)
      .expect(200);
    expect(pendingAfter.body).toEqual([]);

    const complianceRes = await http()
      .get(`/customers/${CUSTOMER_ID}/compliance?audience=customer`)
      .set(portalHeaders)
      .expect(200);
    expect(complianceRes.body).toMatchObject({
      customerId: CUSTOMER_ID,
      audience: 'customer',
      roles: ['customer'],
      compliant: true,
    });
    expect(complianceRes.body.details.DPA_CUSTOMER).toMatchObject({
      requiredVersionId: versionId,
      acceptedVersionId: versionId,
      state: 'ACCEPTED',
      method: 'ACTIVE_CONSENT',
    });

    // 8) Admin document list is FLAT: { id, type, audience, name, currentVersion } with a
    //    version DTO (pdfUrl, no storageKey) — the ZodError shape regression stays fixed.
    const documentsRes = await http().get('/admin/documents').set(adminHeaders).expect(200);
    expect(documentsRes.body.items).toHaveLength(1);
    expect(documentsRes.body.items[0]).toMatchObject({
      id: documentId,
      type: 'dpa',
      audience: 'customer',
      name: 'DPA — Customers',
    });
    expect(documentsRes.body.items[0]).not.toHaveProperty('document');
    expect(documentsRes.body.items[0].currentVersion).toMatchObject({ id: versionId, status: 'PUBLISHED' });
    expect(documentsRes.body.items[0].currentVersion.pdfUrl).toContain('expires=900');
    expect(documentsRes.body.items[0].currentVersion).not.toHaveProperty('storageKey');

    // Versions list carries the same DTO incl. pdfUrl.
    const versionsRes = await http().get(`/admin/documents/${documentId}/versions`).set(adminHeaders).expect(200);
    expect(versionsRes.body.items[0].pdfUrl).toContain('expires=900');
    expect(versionsRes.body.items[0]).not.toHaveProperty('storageKey');

    // 9) Integration onboarding: a tool creates a customer with a signed-offer import in one
    //    call (service token WITHOUT x-customer-id) — immediately compliant.
    const onboardRes = await http()
      .post('/customers')
      .set({ 'x-service-token': SERVICE_TOKEN, 'x-actor-user-id': 'sales-7' })
      .send({
        externalRef: 'company-boot-2',
        name: 'Boot Two GmbH',
        roles: ['customer'],
        contactEmails: ['legal@boot2.example'],
        acceptedVersions: [{ versionId, acceptedAt: '2026-01-02T00:00:00Z', reference: 'signed offer 4711' }],
      })
      .expect(201);
    expect(onboardRes.body).toMatchObject({ externalRef: 'company-boot-2', name: 'Boot Two GmbH' });
    expect(onboardRes.body.importedAcceptances).toEqual([{ versionId, acceptanceId: expect.any(String) }]);

    const onboardedId: string = onboardRes.body.id;
    const onboardedCompliance = await http()
      .get(`/customers/${onboardedId}/compliance?audience=customer`)
      .set({ ...portalHeaders, 'x-customer-id': onboardedId })
      .expect(200);
    expect(onboardedCompliance.body).toMatchObject({ compliant: true });
    expect(onboardedCompliance.body.details.DPA_CUSTOMER).toMatchObject({ state: 'ACCEPTED', method: 'IMPORT' });

    // Admin customer administration sees both customers (sorted by name; '' sorts first).
    const customersRes = await http().get('/admin/customers').set(adminHeaders).expect(200);
    expect(customersRes.body.total).toBe(2);
    expect(customersRes.body.items.map((c: { externalRef: string }) => c.externalRef)).toEqual([
      'company-boot-1',
      'company-boot-2',
    ]);

    // Overview rows include the customer name (known gap fixed).
    const overviewRes = await http().get('/admin/overview').set(adminHeaders).expect(200);
    const overviewRow = overviewRes.body.items.find((r: { customerId: string }) => r.customerId === onboardedId);
    expect(overviewRow).toMatchObject({ customerName: 'Boot Two GmbH' });
  });

  it('DomainErrorFilter is globally active: unknown version → 404 VERSION_NOT_FOUND', async () => {
    const res = await request(app.getHttpServer())
      .get('/admin/versions/does-not-exist')
      .set(adminHeaders)
      .expect(404);
    expect(res.body).toMatchObject({ code: 'VERSION_NOT_FOUND' });
  });
});

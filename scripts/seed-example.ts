import 'dotenv/config';
/**
 * Quick-start seed: boots the service with REPOSITORY_DRIVER=inmemory (no Postgres needed) and
 * builds a small but realistic sample configuration through the REAL admin HTTP API — the fastest
 * way to see the admin surface (dynamic-entity CRUD, documents/versions/publish and the customer
 * list with its document-type / audience / compliance-status filters) actually do something.
 *
 * What it creates:
 *   - audiences:      "customer" (Customers), "partner" (Partners)
 *   - document types: "terms" (Terms of Service), "dpa" (Data Processing Agreement)
 *   - documents (each with a published version → an onboarding rollout happens):
 *       · terms/customer  — ACTIVE  (consent + absolute ~30-day hard deadline)
 *       · dpa/customer    — PASSIVE (14-day objection period)
 *       · terms/partner   — ACTIVE  (consent + absolute ~30-day hard deadline)
 *     → documentType=terms spans customer+partner, documentType=dpa is customer-only, and
 *       audience=partner is partner-only — so the list filters visibly NARROW the rows.
 *   - customers (created AFTER publishing so compliance + audience filters differ):
 *       · Acme        (customer)          — imports terms + dpa      → compliant
 *       · Globex      (customer)          — no imports               → pending on terms + dpa
 *       · Initech     (customer)          — imports terms only       → pending on dpa
 *       · Partner One (partner)           — no imports               → pending on terms/partner
 *       · Umbrella    (customer, partner) — no imports               → pending across the board
 *
 * Usage (from the repo root):
 *   ~/.local/bin/pnpm exec ts-node scripts/seed-example.ts
 *
 * The app keeps running afterwards (Ctrl+C to stop) so the result can be explored, e.g.:
 *   curl -H "x-admin-token: dev-admin-token" http://localhost:3000/admin/customers
 *   curl -H "x-admin-token: dev-admin-token" 'http://localhost:3000/admin/customers?documentType=dpa'
 *   curl -H "x-admin-token: dev-admin-token" 'http://localhost:3000/admin/customers?audience=partner'
 *
 * NOTE: in-memory storage — nothing survives a restart (see docs/PERSISTENCE.md).
 */
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { configureApp } from '../src/bootstrap';

const PORT = Number(process.env.PORT ?? 3000);
const ADMIN_TOKEN = process.env.ADMIN_API_TOKEN ?? 'dev-admin-token';
const ADMIN_HEADERS = {
  'content-type': 'application/json',
  'x-admin-token': ADMIN_TOKEN,
  'x-admin-user': 'seed-example',
};

/** Minimal valid PDF — enough for the version upload; the seed does not render it. */
const MINIMAL_PDF_BASE64 = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF').toString('base64');

interface DynamicEntity {
  id: string;
  key: string;
  name: string;
}

/** POST helper that fails loudly (throws) on any non-2xx response. */
const postJson = async <T>(baseUrl: string, path: string, body: unknown): Promise<T> => {
  const res = await fetch(`${baseUrl}${path}`, { method: 'POST', headers: ADMIN_HEADERS, body: JSON.stringify(body) });
  if (!res.ok) {
    throw new Error(`POST ${path} ${JSON.stringify(body)} → ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as T;
};

const createDynamicEntity = (baseUrl: string, path: string, body: { key: string; name: string }) =>
  postJson<DynamicEntity>(baseUrl, path, body);

interface PublishedDocument {
  documentId: string;
  versionId: string;
}

/**
 * Creates a document, uploads a DRAFT version (base64 PDF fallback) and publishes it so a rollout
 * happens. ACTIVE documents get a consent text + absolute hard deadline, PASSIVE ones an objection period.
 * Returns the (published) versionId so it can be imported as an accepted version on a customer.
 */
async function createPublishedDocument(
  baseUrl: string,
  spec: { type: string; audience: string; name: string; acceptanceMode: 'ACTIVE' | 'PASSIVE' },
): Promise<PublishedDocument> {
  const document = await postJson<{ id: string }>(baseUrl, '/admin/documents', {
    type: spec.type,
    audience: spec.audience,
    name: spec.name,
  });
  // ACTIVE now uses an absolute hard deadline (~30 days out); PASSIVE keeps its objection period.
  const modeFields =
    spec.acceptanceMode === 'ACTIVE'
      ? {
          consentText: 'I have read and accept this document.',
          hardDeadlineAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        }
      : { objectionPeriodDays: 14 };
  const version = await postJson<{ versionId: string }>(baseUrl, `/admin/documents/${document.id}/versions`, {
    file: MINIMAL_PDF_BASE64,
    fileName: `${spec.type}-${spec.audience}.pdf`,
    versionLabel: '2026-07',
    changeSummary: 'Initial published revision (quickstart seed).',
    acceptanceMode: spec.acceptanceMode,
    ...modeFields,
    validFrom: new Date().toISOString(),
  });
  await postJson(baseUrl, `/admin/versions/${version.versionId}/publish`, {});
  return { documentId: document.id, versionId: version.versionId };
}

interface CustomerSpec {
  externalRef: string;
  firstName: string;
  lastName: string;
  companyName: string;
  roles: string[];
  contactEmails: string[];
  acceptedVersions?: { versionId: string }[];
}

const createCustomer = (baseUrl: string, spec: CustomerSpec) =>
  postJson<{ id: string; companyName?: string }>(baseUrl, '/admin/customers', spec);

async function bootApp(): Promise<INestApplication> {
  // REPOSITORY_DRIVER must be set before AppModule is evaluated (RepositoryModule.forRoot()
  // reads it while the module metadata is built) — same trick as test/app.boot.spec.ts.
  process.env.REPOSITORY_DRIVER = process.env.REPOSITORY_DRIVER ?? 'inmemory';
  process.env.ADMIN_API_TOKEN = ADMIN_TOKEN;
  process.env.POSTMARK_API_TOKEN = process.env.POSTMARK_API_TOKEN ?? ''; // noop client, no real sending

  const { AppModule } = await import('../src/app.module');
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
  await configureApp(app);
  await app.listen(PORT);
  return app;
}

async function main(): Promise<void> {
  await bootApp();
  const baseUrl = `http://localhost:${PORT}`;

  const audiences = await Promise.all([
    createDynamicEntity(baseUrl, '/admin/audiences', { key: 'customer', name: 'Customers' }),
    createDynamicEntity(baseUrl, '/admin/audiences', { key: 'partner', name: 'Partners' }),
  ]);
  const documentTypes = await Promise.all([
    createDynamicEntity(baseUrl, '/admin/document-types', { key: 'terms', name: 'Terms of Service' }),
    createDynamicEntity(baseUrl, '/admin/document-types', { key: 'dpa', name: 'Data Processing Agreement' }),
  ]);

  // Publish one version per document so the customers created below get an onboarding rollout.
  const termsCustomer = await createPublishedDocument(baseUrl, {
    type: 'terms',
    audience: 'customer',
    name: 'Terms of Service — Customers',
    acceptanceMode: 'ACTIVE',
  });
  const dpaCustomer = await createPublishedDocument(baseUrl, {
    type: 'dpa',
    audience: 'customer',
    name: 'Data Processing Agreement — Customers',
    acceptanceMode: 'PASSIVE',
  });
  const termsPartner = await createPublishedDocument(baseUrl, {
    type: 'terms',
    audience: 'partner',
    name: 'Terms of Service — Partners',
    acceptanceMode: 'ACTIVE',
  });

  // Customers with varied roles + imports so the compliance chip and the filters differ per row.
  const customers = [];
  customers.push(
    await createCustomer(baseUrl, {
      externalRef: 'acme-crm-001',
      firstName: 'Dana',
      lastName: 'Meyer',
      companyName: 'Acme GmbH',
      roles: ['customer'],
      contactEmails: ['legal@acme.example'],
      acceptedVersions: [{ versionId: termsCustomer.versionId }, { versionId: dpaCustomer.versionId }],
    }),
  );
  customers.push(
    await createCustomer(baseUrl, {
      externalRef: 'globex-crm-002',
      firstName: 'Sam',
      lastName: 'Fischer',
      companyName: 'Globex Corp',
      roles: ['customer'],
      contactEmails: ['ops@globex.example'],
    }),
  );
  customers.push(
    await createCustomer(baseUrl, {
      externalRef: 'initech-crm-003',
      firstName: 'Robin',
      lastName: 'Weber',
      companyName: 'Initech LLC',
      roles: ['customer'],
      contactEmails: ['contracts@initech.example'],
      acceptedVersions: [{ versionId: termsCustomer.versionId }],
    }),
  );
  customers.push(
    await createCustomer(baseUrl, {
      externalRef: 'partnerone-crm-004',
      firstName: 'Alex',
      lastName: 'Schneider',
      companyName: 'Partner One AG',
      roles: ['partner'],
      contactEmails: ['partners@partnerone.example'],
    }),
  );
  customers.push(
    await createCustomer(baseUrl, {
      externalRef: 'umbrella-crm-005',
      firstName: 'Kim',
      lastName: 'Wagner',
      companyName: 'Umbrella Inc',
      roles: ['customer', 'partner'],
      contactEmails: ['legal@umbrella.example'],
    }),
  );

  const documents = { termsCustomer, dpaCustomer, termsPartner };
  // eslint-disable-next-line no-console
  console.log('Seeded example configuration:');
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ audiences, documentTypes, documents, customers }, null, 2));
  // eslint-disable-next-line no-console
  console.log(`\nAdmin API is live at ${baseUrl} (header "x-admin-token: ${ADMIN_TOKEN}"). Ctrl+C to stop.`);
  // eslint-disable-next-line no-console
  console.log('Try the list filters, e.g.:');
  // eslint-disable-next-line no-console
  console.log(`  curl -H "x-admin-token: ${ADMIN_TOKEN}" '${baseUrl}/admin/customers?documentType=dpa'`);
  // eslint-disable-next-line no-console
  console.log(`  curl -H "x-admin-token: ${ADMIN_TOKEN}" '${baseUrl}/admin/customers?audience=partner'`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});

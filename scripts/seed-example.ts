import 'dotenv/config';
/**
 * Quick-start seed: boots the service with REPOSITORY_DRIVER=inmemory (no Postgres needed) and
 * creates a minimal sample configuration through the REAL admin HTTP API — this is the fastest
 * way to see the wave-A dynamic-entity CRUD endpoints (GET/POST/PATCH/DELETE
 * /admin/audiences|document-types) in action:
 *
 *   - audiences:      "customer", "partner"
 *   - document types: "terms", "dpa"
 *   - one demo customer with the "customer" role (via POST /admin/customers)
 *
 * Usage (from the repo root):
 *   ~/.local/bin/pnpm exec ts-node scripts/seed-example.ts
 *
 * The app keeps running afterwards (Ctrl+C to stop) so the result can be explored, e.g.:
 *   curl -H "x-admin-token: dev-admin-token" http://localhost:3000/admin/audiences
 *   curl -H "x-admin-token: dev-admin-token" http://localhost:3000/admin/document-types
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

interface DynamicEntity {
  id: string;
  key: string;
  name: string;
}

const createDynamicEntity = async (baseUrl: string, path: string, body: { key: string; name: string }) => {
  const res = await fetch(`${baseUrl}${path}`, { method: 'POST', headers: ADMIN_HEADERS, body: JSON.stringify(body) });
  if (!res.ok) {
    throw new Error(`POST ${path} ${JSON.stringify(body)} → ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as DynamicEntity;
};

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

  // Customers now have real admin CRUD — seed the demo customer through the HTTP API too.
  const customerRes = await fetch(`${baseUrl}/admin/customers`, {
    method: 'POST',
    headers: ADMIN_HEADERS,
    body: JSON.stringify({
      externalRef: 'demo-company',
      firstName: 'Dana',
      lastName: 'Müller',
      companyName: 'Demo Company GmbH',
      roles: ['customer'],
      contactEmails: ['legal@demo.example'],
    }),
  });
  if (!customerRes.ok) {
    throw new Error(`POST /admin/customers → ${customerRes.status}: ${await customerRes.text()}`);
  }
  const demoCustomer = await customerRes.json();

  // eslint-disable-next-line no-console
  console.log('Seeded example configuration:');
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ audiences, documentTypes, demoCustomer }, null, 2));
  // eslint-disable-next-line no-console
  console.log(`\nAdmin API is live at ${baseUrl} (header "x-admin-token: ${ADMIN_TOKEN}"). Ctrl+C to stop.`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});

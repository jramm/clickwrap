/**
 * Boot test for FILE_STORAGE=local through the FULL AppModule: upload a version PDF via the admin
 * API, follow the minted HMAC-signed /files URL (relative — no PUBLIC_BASE_URL) and download the
 * exact bytes back through the plugin's controller. Proves the registry-selected storage plugin,
 * the PdfStorage adapter and the gated download controller end-to-end.
 */
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';

const ADMIN_TOKEN = 'local-boot-admin-token';
const adminHeaders = { 'x-admin-token': ADMIN_TOKEN, 'x-admin-user': 'admin-1' };
const PDF_BYTES = Buffer.from('%PDF-1.7 local-storage-boot-test');

describe('AppModule boot with FILE_STORAGE=local', () => {
  let app: INestApplication;
  let storageDir: string;

  beforeAll(async () => {
    storageDir = mkdtempSync(join(tmpdir(), 'clickwrap-local-boot-'));
    // @prisma/client loads .env on first import (it sits in the AppModule import chain). Import
    // it BEFORE pinning the env below, otherwise a developer .env (e.g. PUBLIC_BASE_URL) would
    // silently re-populate the variables this spec just deleted.
    await import('@prisma/client');
    process.env.REPOSITORY_DRIVER = 'inmemory';
    process.env.ADMIN_API_TOKEN = ADMIN_TOKEN;
    process.env.FILE_STORAGE = 'local';
    process.env.FILE_STORAGE_LOCAL_DIR = storageDir;
    process.env.FILE_STORAGE_LOCAL_SECRET = 'local-boot-secret';
    delete process.env.PUBLIC_BASE_URL; // relative /files URLs

    const { AppModule } = await import('../src/app.module.js');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    rmSync(storageDir, { recursive: true, force: true });
    delete process.env.FILE_STORAGE;
    delete process.env.FILE_STORAGE_LOCAL_DIR;
    delete process.env.FILE_STORAGE_LOCAL_SECRET;
  });

  it('stores an uploaded version PDF on disk and serves it back via the signed /files URL', async () => {
    const http = () => request(app.getHttpServer());

    // audience "customer" + document type "dpa" are created at boot by the LegalEntitiesReconciler
    // from the demo config (config/legal-entities.json) — no manual seeding needed.
    const documentRes = await http()
      .post('/admin/documents')
      .set(adminHeaders)
      .send({ type: 'dpa', audience: 'customer', name: 'DPA — Customers' })
      .expect(201);

    await http()
      .post(`/admin/documents/${documentRes.body.id}/versions`)
      .set(adminHeaders)
      .field('versionLabel', 'July 2026 edition')
      .field('changeSummary', 'Local storage boot test.')
      .field('acceptanceMode', 'ACTIVE')
      .field('consentText', 'I agree.')
      .field('gracePeriodDays', '14')
      .field('validFrom', '2026-01-01')
      .attach('file', PDF_BYTES, 'dpa-2026-07.pdf')
      .expect(201);

    const versionsRes = await http()
      .get(`/admin/documents/${documentRes.body.id}/versions`)
      .set(adminHeaders)
      .expect(200);
    const pdfUrl: string = versionsRes.body.items[0].pdfUrl;
    expect(pdfUrl).toMatch(/^\/files\/[0-9a-f-]{36}\.pdf\?expires=\d+&sig=[0-9a-f]{64}$/);

    // The signed URL is served by the plugin's own controller (mounted only for FILE_STORAGE=local).
    const download = await http().get(pdfUrl).expect(200);
    expect(download.headers['content-type']).toContain('application/pdf');
    expect(download.headers['content-disposition']).toBe('inline; filename="dpa-2026-07.pdf"');
    expect(Buffer.from(download.body).toString()).toBe(PDF_BYTES.toString());

    // Tampering with the signature is rejected.
    await http().get(pdfUrl.replace(/sig=[0-9a-f]{6}/, 'sig=000000')).expect(403);
  });
});

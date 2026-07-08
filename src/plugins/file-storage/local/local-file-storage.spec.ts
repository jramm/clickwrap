import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { createPluginContext } from '../../registry/plugin-context';
import { localFileStoragePlugin } from '../../builtins/local-file-storage.plugin';
import { LocalFilesController } from './local-files.controller';
import { LocalFileStorage } from './local-file-storage';

const UUID_PDF = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$/;
const SECRET = 'test-secret';

describe('LocalFileStorage', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clickwrap-local-storage-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates the storage directory recursively on construction', () => {
    const nested = join(dir, 'a', 'b', 'c');
    new LocalFileStorage({ dir: nested, secret: SECRET });
    expect(existsSync(nested)).toBe(true);
  });

  it('stores under a generated uuid key — the original fileName never ends up in the path', async () => {
    const storage = new LocalFileStorage({ dir, secret: SECRET });
    const { storageKey } = await storage.store(Buffer.from('%PDF-1.7 x'), { fileName: '../../etc/passwd.pdf' });
    expect(storageKey).toMatch(UUID_PDF);
    expect(existsSync(join(dir, storageKey))).toBe(true);
  });

  it('presigned URLs carry expires (~15 min) + hmac sig and honor the base URL', async () => {
    const storage = new LocalFileStorage({ dir, secret: SECRET, baseUrl: 'https://api.example.org/' });
    const { storageKey } = await storage.store(Buffer.from('%PDF-1.7 x'), { fileName: 'a.pdf' });
    const url = new URL(await storage.getPresignedUrl(storageKey));
    expect(url.origin).toBe('https://api.example.org');
    expect(url.pathname).toBe(`/files/${storageKey}`);
    const expires = Number(url.searchParams.get('expires'));
    expect(expires).toBeGreaterThan(Date.now() / 1000 + 800);
    expect(expires).toBeLessThanOrEqual(Date.now() / 1000 + 900);
    expect(url.searchParams.get('sig')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('getPresignedUrl rejects unknown storage keys', async () => {
    const storage = new LocalFileStorage({ dir, secret: SECRET });
    await expect(storage.getPresignedUrl('00000000-0000-4000-8000-000000000000.pdf')).rejects.toThrow(/No PDF/);
  });

  describe('GET /files/:storageKey (plugin controller)', () => {
    let app: INestApplication;
    let storage: LocalFileStorage;

    beforeEach(async () => {
      storage = new LocalFileStorage({ dir, secret: SECRET });
      const moduleRef = await Test.createTestingModule({
        controllers: [LocalFilesController],
        providers: [{ provide: LocalFileStorage, useValue: storage }],
      }).compile();
      app = moduleRef.createNestApplication();
      await app.init();
    });

    afterEach(async () => {
      await app.close();
    });

    const storeAndUrl = async (): Promise<{ storageKey: string; path: string }> => {
      const { storageKey } = await storage.store(Buffer.from('%PDF-1.7 local'), { fileName: 'dpa 2026.pdf' });
      const url = await storage.getPresignedUrl(storageKey);
      return { storageKey, path: url };
    };

    it('streams the stored file within the TTL (inline, original fileName, application/pdf)', async () => {
      const { path } = await storeAndUrl();
      const res = await request(app.getHttpServer()).get(path).expect(200);
      expect(res.headers['content-type']).toContain('application/pdf');
      expect(res.headers['content-disposition']).toBe('inline; filename="dpa 2026.pdf"');
      expect(res.body.toString()).toBe('%PDF-1.7 local');
    });

    it('403 on an expired link (even with a valid signature for that expiry)', async () => {
      const { storageKey } = await storeAndUrl();
      const expired = Math.floor(Date.now() / 1000) - 10;
      const sig = storage.signForTesting(storageKey, expired);
      await request(app.getHttpServer()).get(`/files/${storageKey}?expires=${expired}&sig=${sig}`).expect(403);
    });

    it('403 on a tampered signature', async () => {
      const { path } = await storeAndUrl();
      const url = new URL(path, 'http://local');
      url.searchParams.set('sig', 'f'.repeat(64));
      await request(app.getHttpServer()).get(`${url.pathname}?${url.searchParams.toString()}`).expect(403);
    });

    it('403 when the signature was issued for a different key', async () => {
      const first = await storeAndUrl();
      const second = await storeAndUrl();
      const firstUrl = new URL(first.path, 'http://local');
      await request(app.getHttpServer())
        .get(`/files/${second.storageKey}?${firstUrl.searchParams.toString()}`)
        .expect(403);
    });

    it('403 on missing sig/expires', async () => {
      const { storageKey } = await storeAndUrl();
      await request(app.getHttpServer()).get(`/files/${storageKey}`).expect(403);
    });

    it('rejects path traversal attempts before any filesystem access', async () => {
      const expires = Math.floor(Date.now() / 1000) + 900;
      // Traversal-shaped keys either never reach the handler (the Express 5 router refuses
      // encoded slashes and dot-segments → 404 without any handler code running) or fail the
      // strict key pattern → 403. Both mean: no filesystem access.
      for (const key of ['..%2F..%2Fetc%2Fpasswd', '..\\secret.pdf']) {
        const sig = storage.signForTesting(decodeURIComponent(key), expires);
        const res = await request(app.getHttpServer()).get(`/files/${key}?expires=${expires}&sig=${sig}`);
        expect([403, 404]).toContain(res.status);
      }
      // Keys that route but are not host-generated fail the pattern → 403.
      for (const key of ['no-uuid.pdf', '00000000-0000-4000-8000-000000000000.PDF']) {
        const sig = storage.signForTesting(key, expires);
        await request(app.getHttpServer()).get(`/files/${key}?expires=${expires}&sig=${sig}`).expect(403);
      }
    });

    it('404 for a valid signature over a key that does not exist', async () => {
      const ghost = '00000000-0000-4000-8000-000000000000.pdf';
      const expires = Math.floor(Date.now() / 1000) + 900;
      const sig = storage.signForTesting(ghost, expires);
      await request(app.getHttpServer()).get(`/files/${ghost}?expires=${expires}&sig=${sig}`).expect(404);
    });
  });

  describe('local plugin activation (env)', () => {
    const savedEnv = { ...process.env };

    afterEach(() => {
      process.env = { ...savedEnv };
    });

    it('boot error when FILE_STORAGE_LOCAL_DIR is missing while active', () => {
      delete process.env.FILE_STORAGE_LOCAL_DIR;
      process.env.FILE_STORAGE_LOCAL_SECRET = SECRET;
      expect(() => localFileStoragePlugin.create(createPluginContext(localFileStoragePlugin))).toThrow(
        /FILE_STORAGE_LOCAL_DIR/,
      );
    });

    it('boot error when FILE_STORAGE_LOCAL_SECRET is missing while active', () => {
      process.env.FILE_STORAGE_LOCAL_DIR = dir;
      delete process.env.FILE_STORAGE_LOCAL_SECRET;
      expect(() => localFileStoragePlugin.create(createPluginContext(localFileStoragePlugin))).toThrow(
        /FILE_STORAGE_LOCAL_SECRET/,
      );
    });

    it('creates a LocalFileStorage from env when fully configured', () => {
      process.env.FILE_STORAGE_LOCAL_DIR = join(dir, 'files');
      process.env.FILE_STORAGE_LOCAL_SECRET = SECRET;
      expect(localFileStoragePlugin.create(createPluginContext(localFileStoragePlugin))).toBeInstanceOf(
        LocalFileStorage,
      );
      expect(existsSync(join(dir, 'files'))).toBe(true);
    });
  });
});

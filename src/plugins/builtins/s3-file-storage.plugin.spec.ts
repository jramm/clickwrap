import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PluginRegistry } from '../registry/plugin-registry.js';
import { createPluginContext } from '../registry/plugin-context.js';
import { S3FileStorage } from '../file-storage/s3/s3-file-storage.js';
import { s3FileStoragePlugin } from './s3-file-storage.plugin.js';

describe('s3 file-storage plugin', () => {
  const savedEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it('is registered and selectable as the s3 file-storage plugin', () => {
    const root = mkdtempSync(join(tmpdir(), 'clickwrap-s3-registry-'));
    try {
      const registry = PluginRegistry.bootstrap({ appRoot: root, pluginPaths: [] });
      expect(registry.keys('file-storage')).toContain('s3');
      expect(registry.select('file-storage', 's3', 'FILE_STORAGE').key).toBe('s3');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('boot error when FILE_STORAGE_S3_BUCKET is missing while active', () => {
    delete process.env.FILE_STORAGE_S3_BUCKET;
    process.env.FILE_STORAGE_S3_REGION = 'eu-central-1';
    expect(() => s3FileStoragePlugin.create(createPluginContext(s3FileStoragePlugin))).toThrow(
      /FILE_STORAGE_S3_BUCKET/,
    );
  });

  it('boot error when FILE_STORAGE_S3_REGION is missing while active', () => {
    process.env.FILE_STORAGE_S3_BUCKET = 'clickwrap-documents';
    delete process.env.FILE_STORAGE_S3_REGION;
    expect(() => s3FileStoragePlugin.create(createPluginContext(s3FileStoragePlugin))).toThrow(
      /FILE_STORAGE_S3_REGION/,
    );
  });

  it('creates an S3FileStorage from env when bucket + region are set (default credential chain)', () => {
    process.env.FILE_STORAGE_S3_BUCKET = 'clickwrap-documents';
    process.env.FILE_STORAGE_S3_REGION = 'eu-central-1';
    delete process.env.FILE_STORAGE_S3_ACCESS_KEY_ID;
    delete process.env.FILE_STORAGE_S3_SECRET_ACCESS_KEY;
    expect(s3FileStoragePlugin.create(createPluginContext(s3FileStoragePlugin))).toBeInstanceOf(S3FileStorage);
  });
});

import { FileStorageModule } from './file-storage.module.js';
import { LocalFilesController } from './local/local-files.controller.js';

/** Restores the relevant env after each test so cases do not leak into each other. */
const withEnv = (env: Record<string, string | undefined>, run: () => void): void => {
  const keys = ['FILE_STORAGE', 'FILE_STORAGE_LOCAL_DIR', 'FILE_STORAGE_LOCAL_SECRET'];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  try {
    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
    run();
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = saved[k];
      }
    }
  }
};

describe('FileStorageModule.forRoot controller gating', () => {
  it('defaults to memory: no download controller is mounted', () => {
    withEnv({ FILE_STORAGE: undefined }, () => {
      const module = FileStorageModule.forRoot();
      expect(module.controllers).toEqual([]);
      expect(module.global).toBe(true);
    });
  });

  it('mounts the /files download controller ONLY for FILE_STORAGE=local', () => {
    withEnv({ FILE_STORAGE: 'local' }, () => {
      const module = FileStorageModule.forRoot();
      expect(module.controllers).toContain(LocalFilesController);
    });
    withEnv({ FILE_STORAGE: 'memory' }, () => {
      expect(FileStorageModule.forRoot().controllers).toEqual([]);
    });
  });

  it('unknown FILE_STORAGE key → boot error listing the available keys', () => {
    withEnv({ FILE_STORAGE: 'gcs' }, () => {
      expect(() => FileStorageModule.forRoot()).toThrow(/Unknown FILE_STORAGE "gcs".*local.*memory.*s3/);
    });
  });
});

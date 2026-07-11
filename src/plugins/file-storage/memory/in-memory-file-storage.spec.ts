import { InMemoryFileStorage } from './in-memory-file-storage.js';

describe('InMemoryFileStorage', () => {
  it('retrieve returns the exact stored bytes (roundtrip)', async () => {
    const storage = new InMemoryFileStorage();
    const content = Buffer.from('%PDF-1.7 roundtrip  ÿ', 'binary');
    const { storageKey } = await storage.store(content, { fileName: 'a.pdf' });

    const retrieved = await storage.retrieve(storageKey);

    expect(retrieved.equals(content)).toBe(true);
  });

  it('retrieve returns an independent copy (mutation does not corrupt the store)', async () => {
    const storage = new InMemoryFileStorage();
    const { storageKey } = await storage.store(Buffer.from('original'), { fileName: 'a.pdf' });

    const first = await storage.retrieve(storageKey);
    first.write('X');

    const second = await storage.retrieve(storageKey);
    expect(second.toString()).toBe('original');
  });

  it('retrieve rejects unknown storage keys', async () => {
    const storage = new InMemoryFileStorage();
    await expect(storage.retrieve('s3://clickwrap-documents/missing/x.pdf')).rejects.toThrow(/No PDF/);
  });
});

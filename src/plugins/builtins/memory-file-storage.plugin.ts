import { definePlugin } from '../../plugin-sdk';
import { InMemoryFileStorage } from '../file-storage/memory/in-memory-file-storage';

/** Default file storage: in-memory (dev/demo/tests — nothing survives a restart). */
export const memoryFileStoragePlugin = definePlugin({
  kind: 'file-storage',
  key: 'memory',
  create: () => new InMemoryFileStorage(),
});

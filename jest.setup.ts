/**
 * ESM jest caveat: with --experimental-vm-modules jest injects describe/it/expect as globals but
 * NOT the `jest` object (it must normally be imported from '@jest/globals'). The suite was written
 * against the CJS behaviour where `jest` is a global (jest.fn/spyOn/useFakeTimers/…), so we restore
 * that here once, globally, instead of adding an import to every spec file.
 */
import { jest } from '@jest/globals';

(globalThis as typeof globalThis & { jest: typeof jest }).jest = jest;

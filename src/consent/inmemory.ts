/**
 * In-memory implementations of the module-local ports.
 * For tests and REPOSITORY_DRIVER=inmemory operation (does not survive restarts).
 */
import { randomUUID } from 'node:crypto';
import type { IdempotencyStore, IdGenerator } from './ports';

/** Internal marker for "reserved, response not stored yet" (putIfAbsent). */
const PENDING = Symbol('idempotency-pending');

export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly entries = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    const value = this.entries.get(key);
    return value === PENDING ? undefined : (value as T | undefined);
  }

  async put<T>(key: string, value: T): Promise<void> {
    this.entries.set(key, value);
  }

  async reserve(key: string): Promise<boolean> {
    if (this.entries.has(key)) {
      return false;
    }
    this.entries.set(key, PENDING);
    return true;
  }

  async release(key: string): Promise<void> {
    if (this.entries.get(key) === PENDING) {
      this.entries.delete(key);
    }
  }
}

/** Production ID generation. */
export class UuidIdGenerator implements IdGenerator {
  next(prefix: string): string {
    return `${prefix}-${randomUUID()}`;
  }
}

/** Deterministic, sequential IDs (`a-1`, `a-2`, …) — for tests. */
export class SequentialIdGenerator implements IdGenerator {
  private readonly counters = new Map<string, number>();

  next(prefix: string): string {
    const value = (this.counters.get(prefix) ?? 0) + 1;
    this.counters.set(prefix, value);
    return `${prefix}-${value}`;
  }
}

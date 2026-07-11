/**
 * Prisma implementation of the IdempotencyStore (src/consent/ports.ts): persistent variant for
 * REPOSITORY_DRIVER=prisma — stored responses survive restarts (unlike the in-memory variant,
 * see the port docs).
 *
 * putIfAbsent semantics: `reserve` is a `create` — the DB unique constraint on `key`
 * guarantees that under concurrency exactly ONE request gets the reservation (P2002 →
 * false). A reservation is stored as marker JSON (`{"__idempotencyPending": true}`);
 * `get` returns `undefined` for it (no finished response yet), `put` overwrites the marker with
 * the real response, `release` deletes ONLY the marker (never a finished response).
 *
 * Note: the JSON roundtrip serializes Dates to ISO strings — the stored responses of the
 * portal endpoints (AcceptanceResponse/ObjectionResponse) only contain strings, so this is lossless.
 */
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { IdempotencyStore } from '../../consent/ports.js';
import { isUniqueConstraintError } from './prisma-errors.js';
import { PrismaService } from './prisma.service.js';

const PENDING_MARKER = { __idempotencyPending: true } as const;

const isPendingMarker = (value: unknown): boolean =>
  typeof value === 'object' &&
  value !== null &&
  (value as Record<string, unknown>).__idempotencyPending === true;

@Injectable()
export class PrismaIdempotencyStore implements IdempotencyStore {
  constructor(private readonly prisma: PrismaService) {}

  async get<T>(key: string): Promise<T | undefined> {
    const row = await this.prisma.idempotencyRecord.findUnique({ where: { key } });
    if (!row || isPendingMarker(row.value)) {
      return undefined;
    }
    return row.value as T;
  }

  async put<T>(key: string, value: T): Promise<void> {
    const json = value as Prisma.InputJsonValue;
    await this.prisma.idempotencyRecord.upsert({
      where: { key },
      create: { key, value: json },
      update: { value: json },
    });
  }

  async reserve(key: string): Promise<boolean> {
    try {
      await this.prisma.idempotencyRecord.create({
        data: { key, value: PENDING_MARKER as Prisma.InputJsonValue },
      });
      return true;
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        return false; // already reserved or completed — caller waits for the replay
      }
      throw err;
    }
  }

  async release(key: string): Promise<void> {
    // Deletes ONLY an open reservation — a finished response remains untouched.
    await this.prisma.idempotencyRecord.deleteMany({
      where: { key, value: { equals: PENDING_MARKER as Prisma.InputJsonValue } },
    });
  }
}

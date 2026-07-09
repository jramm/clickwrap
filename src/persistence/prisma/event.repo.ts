/**
 * Prisma implementation of EventRepo (src/domain/ports.ts) — the append-only, core-written activity
 * log backing GET /admin/events. `append` is a plain create (duplicate id → INVALID_STATE). `query`
 * filters BEFORE paginating (50/page), sorts occurredAt DESC with a stable id tiebreak, and returns
 * the FILTERED total via a parallel count.
 */
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { DomainError } from '../../common/errors';
import type { EventQueryFilters, EventRepo } from '../../domain/ports';
import type { DomainEvent } from '../../domain/types';
import { EVENTS_PAGE_SIZE } from '../../domain/types';
import { toCreateData, toDomain } from './mappers/event.mapper';
import { isUniqueConstraintError } from './prisma-errors';
import { PrismaService } from './prisma.service';

@Injectable()
export class PrismaEventRepo implements EventRepo {
  constructor(private readonly prisma: PrismaService) {}

  async append(event: DomainEvent): Promise<DomainEvent> {
    try {
      const row = await this.prisma.event.create({ data: toCreateData(event) });
      return toDomain(row);
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        throw new DomainError('INVALID_STATE', `Event ${event.id} already exists (append-only)`);
      }
      throw err;
    }
  }

  async query(filters: EventQueryFilters, page?: number): Promise<{ items: DomainEvent[]; total: number }> {
    const where = toWhere(filters);
    const p = page && page > 0 ? page : 1;
    const [rows, total] = await Promise.all([
      this.prisma.event.findMany({
        where,
        // Newest first; stable tiebreak by id so equal timestamps keep a deterministic order.
        orderBy: [{ occurredAt: 'desc' }, { id: 'asc' }],
        skip: (p - 1) * EVENTS_PAGE_SIZE,
        take: EVENTS_PAGE_SIZE,
      }),
      this.prisma.event.count({ where }),
    ]);
    return { items: rows.map(toDomain), total };
  }
}

const toWhere = (filters: EventQueryFilters): Prisma.EventWhereInput => {
  const where: Prisma.EventWhereInput = {};
  if (filters.customerId !== undefined) {
    where.customerId = filters.customerId;
  }
  if (filters.category !== undefined) {
    where.category = filters.category;
  }
  if (filters.documentType !== undefined) {
    where.documentType = filters.documentType;
  }
  if (filters.versionId !== undefined) {
    where.versionId = filters.versionId;
  }
  if (filters.from !== undefined || filters.to !== undefined) {
    where.occurredAt = {
      ...(filters.from !== undefined ? { gte: filters.from } : {}),
      ...(filters.to !== undefined ? { lte: filters.to } : {}),
    };
  }
  return where;
};

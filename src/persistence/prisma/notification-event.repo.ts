/**
 * Prisma implementation of NotificationEventRepo. Semantics exactly like
 * src/persistence/inmemory/notification-event.repo.ts: `append` is append-only (duplicate id →
 * DomainError('INVALID_STATE', …)); `findByState` sorts by `createdAt` (insertion-order analog
 * to the fake, see the rationale in objection.repo.ts); `findByProviderRef` matches Postmark
 * webhook events by MessageID — `providerRef` is only indexed, not unique (multiple events could
 * theoretically carry the same message ID), hence `findFirst` instead of `findUnique`.
 */
import { Injectable } from '@nestjs/common';
import { DomainError } from '../../common/errors.js';
import type { NotificationEventRepo } from '../../domain/ports.js';
import type { NotificationEvent } from '../../domain/types.js';
import { toCreateData, toDomain } from './mappers/notification-event.mapper.js';
import { isUniqueConstraintError } from './prisma-errors.js';
import { PrismaService } from './prisma.service.js';

@Injectable()
export class PrismaNotificationEventRepo implements NotificationEventRepo {
  constructor(private readonly prisma: PrismaService) {}

  async append(event: NotificationEvent): Promise<NotificationEvent> {
    try {
      const row = await this.prisma.notificationEvent.create({ data: toCreateData(event) });
      return toDomain(row);
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        throw new DomainError('INVALID_STATE', `NotificationEvent ${event.id} already exists (append-only)`);
      }
      throw err;
    }
  }

  async findByState(customerVersionStateId: string): Promise<NotificationEvent[]> {
    const rows = await this.prisma.notificationEvent.findMany({
      where: { customerVersionStateId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toDomain);
  }

  async findByProviderRef(providerRef: string): Promise<NotificationEvent | undefined> {
    const row = await this.prisma.notificationEvent.findFirst({ where: { providerRef } });
    return row ? toDomain(row) : undefined;
  }

  /** All notification events in append order (createdAt asc — insertion-order analog, see findByState). */
  async findAll(): Promise<NotificationEvent[]> {
    const rows = await this.prisma.notificationEvent.findMany({ orderBy: { createdAt: 'asc' } });
    return rows.map(toDomain);
  }
}

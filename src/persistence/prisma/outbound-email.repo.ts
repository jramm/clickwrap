/**
 * Prisma implementation of OutboundEmailRepo (src/plugins/email/core/outbound-email.ts). Semantics
 * exactly as the in-memory repo: `save` = upsert by providerRef; `markDelivered` is idempotent (only
 * set when deliveredAt is still empty — atomic via `updateMany … deliveredAt: null`, like
 * setNotifiedAtomically); `findPendingOlderThan` returns open sends with sentAt < olderThan.
 *
 * NOTE: the persisted column is still named `messageId` (no migration) — the mapper bridges it to the
 * provider-agnostic `providerRef` field.
 */
import { Injectable } from '@nestjs/common';
import type { OutboundEmail, OutboundEmailRepo } from '../../plugins/email/core/outbound-email.js';
import { toDomain, toUpsertData } from './mappers/outbound-email.mapper.js';
import { PrismaService } from './prisma.service.js';

@Injectable()
export class PrismaOutboundEmailRepo implements OutboundEmailRepo {
  constructor(private readonly prisma: PrismaService) {}

  async save(email: OutboundEmail): Promise<OutboundEmail> {
    const data = toUpsertData(email);
    const row = await this.prisma.outboundEmail.upsert({
      where: { messageId: email.providerRef },
      create: { messageId: email.providerRef, ...data },
      update: data,
    });
    return toDomain(row);
  }

  async findByProviderRef(providerRef: string): Promise<OutboundEmail | undefined> {
    const row = await this.prisma.outboundEmail.findUnique({ where: { messageId: providerRef } });
    return row ? toDomain(row) : undefined;
  }

  async markDelivered(providerRef: string, deliveredAt: Date): Promise<OutboundEmail | undefined> {
    await this.prisma.outboundEmail.updateMany({
      where: { messageId: providerRef, deliveredAt: null },
      data: { deliveredAt },
    });
    return this.findByProviderRef(providerRef);
  }

  async findPendingOlderThan(olderThan: Date): Promise<OutboundEmail[]> {
    const rows = await this.prisma.outboundEmail.findMany({
      where: { deliveredAt: null, sentAt: { lt: olderThan } },
      orderBy: { sentAt: 'asc' },
    });
    return rows.map(toDomain);
  }
}

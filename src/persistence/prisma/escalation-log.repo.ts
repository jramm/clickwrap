/**
 * Prisma implementation of the shared EscalationLog (src/common/escalation/escalation-log.ts).
 * Append-only entries for admin/legal (objection after the deadline, e-mail bounce) — semantics
 * like src/common/escalation/escalation-log.inmemory.ts.
 */
import { Injectable } from '@nestjs/common';
import type { EscalationEntry, EscalationLog } from '../../common/escalation/escalation-log';
import { DomainError } from '../../common/errors';
import { toCreateData, toDomain } from './mappers/escalation-entry.mapper';
import { isUniqueConstraintError } from './prisma-errors';
import { PrismaService } from './prisma.service';

@Injectable()
export class PrismaEscalationLog implements EscalationLog {
  constructor(private readonly prisma: PrismaService) {}

  async record(entry: EscalationEntry): Promise<EscalationEntry> {
    try {
      const row = await this.prisma.escalationEntry.create({ data: toCreateData(entry) });
      return toDomain(row);
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        throw new DomainError('INVALID_STATE', `EscalationEntry ${entry.id} already exists (append-only)`);
      }
      throw err;
    }
  }

  async findByCustomer(customerId: string): Promise<EscalationEntry[]> {
    const rows = await this.prisma.escalationEntry.findMany({
      where: { customerId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toDomain);
  }

  async findAll(): Promise<EscalationEntry[]> {
    const rows = await this.prisma.escalationEntry.findMany({ orderBy: { createdAt: 'asc' } });
    return rows.map(toDomain);
  }
}

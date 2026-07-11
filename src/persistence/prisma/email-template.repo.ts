/**
 * Prisma implementation of EmailTemplateRepo. Semantics exactly like
 * src/persistence/inmemory/email-template.repo.ts: `save` is an upsert-by-id; `deleteIfUnused`
 * refuses deletion while the template is still assigned to a DocumentTypeDef
 * (notificationTemplateId / reminderTemplateId) — application-level referential integrity, no FK
 * (see prisma/schema.prisma). The check-then-delete is not transactional; acceptable for an
 * admin-only operation.
 */
import { Injectable } from '@nestjs/common';
import type { EmailTemplateRepo } from '../../domain/ports.js';
import type { EmailTemplate } from '../../domain/types.js';
import { toDomain, toUpsertData } from './mappers/email-template.mapper.js';
import { PrismaService } from './prisma.service.js';

@Injectable()
export class PrismaEmailTemplateRepo implements EmailTemplateRepo {
  constructor(private readonly prisma: PrismaService) {}

  async save(template: EmailTemplate): Promise<EmailTemplate> {
    const data = toUpsertData(template);
    const row = await this.prisma.emailTemplate.upsert({
      where: { id: template.id },
      create: { id: template.id, ...data },
      update: data,
    });
    return toDomain(row);
  }

  async findById(id: string): Promise<EmailTemplate | undefined> {
    const row = await this.prisma.emailTemplate.findUnique({ where: { id } });
    return row ? toDomain(row) : undefined;
  }

  async findAll(): Promise<EmailTemplate[]> {
    const rows = await this.prisma.emailTemplate.findMany();
    return rows.map(toDomain);
  }

  async deleteIfUnused(id: string): Promise<boolean> {
    const existing = await this.prisma.emailTemplate.findUnique({ where: { id } });
    if (!existing) {
      return false;
    }
    const assigned = await this.prisma.documentTypeDef.count({
      where: { OR: [{ notificationTemplateId: id }, { reminderTemplateId: id }] },
    });
    if (assigned > 0) {
      return false;
    }
    await this.prisma.emailTemplate.delete({ where: { id } });
    return true;
  }
}

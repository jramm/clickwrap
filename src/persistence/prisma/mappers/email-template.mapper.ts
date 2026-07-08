import type { EmailTemplate as PrismaEmailTemplate } from '@prisma/client';
import type { EmailTemplate } from '../../../domain/types';

/** Prisma row → domain type. */
export const toDomain = (row: PrismaEmailTemplate): EmailTemplate => ({
  id: row.id,
  name: row.name,
  kind: row.kind,
  subject: row.subject,
  design: row.design,
  html: row.html,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

/** Domain type → Prisma create/update data (id/timestamps handled by the repo/DB). */
export const toUpsertData = (
  template: EmailTemplate,
): { name: string; kind: EmailTemplate['kind']; subject: string; design: string; html: string } => ({
  name: template.name,
  kind: template.kind,
  subject: template.subject,
  design: template.design,
  html: template.html,
});

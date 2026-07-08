import type { Audience as PrismaAudience } from '@prisma/client';
import type { Audience } from '../../../domain/types';

/** Prisma row → domain type (createdAt/updatedAt are infrastructure-only fields). */
export const toDomain = (row: PrismaAudience): Audience => ({
  id: row.id,
  key: row.key,
  name: row.name,
});

/** Domain type → Prisma create/update data. */
export const toUpsertData = (audience: Audience): { key: string; name: string } => ({
  key: audience.key,
  name: audience.name,
});

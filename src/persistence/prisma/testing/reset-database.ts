/**
 * Resets the test DB between Prisma repo specs — FK-safe delete order (evidence/detail
 * tables first, then the aggregates). Intended for `*.prisma.spec.ts` only, never for
 * application code: Acceptance/Objection/NotificationEvent are DELETE-locked in staging/prod
 * via `prisma/partial-indexes.sql` (the test DB typically runs locally with a combined
 * migration/runtime role, see docs/PERSISTENCE.md, so this is uncritical here).
 */
import type { PrismaService } from '../prisma.service';

export const resetDatabase = async (prisma: PrismaService): Promise<void> => {
  await prisma.notificationEvent.deleteMany();
  await prisma.objection.deleteMany();
  await prisma.acceptance.deleteMany();
  await prisma.customerVersionState.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.agreementVersion.deleteMany();
  await prisma.agreementDocument.deleteMany();
  // Audience/DocumentTypeDef are referenced by AgreementDocument at the application level only
  // (no FK) — delete them after the documents anyway to keep the order semantically FK-safe.
  await prisma.audience.deleteMany();
  await prisma.documentTypeDef.deleteMany();
  await prisma.adminAuditLog.deleteMany();
  await prisma.acceptanceLink.deleteMany();
};

/**
 * Translation of known Prisma error codes into DomainError — centralized instead of duplicated
 * per repo. See docs/PERSISTENCE.md ("Error translation") for the Prisma code → DomainErrorCode
 * mapping.
 */
import { Prisma } from '@prisma/client';

/** P2002 = "Unique constraint failed" — fires for EVERY unique violation reported by the DB, */
/** including indexes Prisma doesn't know from its own schema (e.g. our partial index). */
export const isUniqueConstraintError = (err: unknown): err is Prisma.PrismaClientKnownRequestError =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';

/** P2025 = "Record to update/delete not found". */
export const isRecordNotFoundError = (err: unknown): err is Prisma.PrismaClientKnownRequestError =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025';

/** P2003 = "Foreign key constraint failed" (e.g. documentId points at a non-existent document). */
export const isForeignKeyConstraintError = (err: unknown): err is Prisma.PrismaClientKnownRequestError =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003';

/**
 * Field names/constraint name of the unique violation. For constraints Prisma recognizes (e.g.
 * @@unique fields from the schema), `meta.target` is an array of field names; for constraints
 * Prisma doesn't know from its own schema (our partial index from partial-indexes.sql), the
 * query engine instead returns the raw DB constraint name as a string. Both are normalized here
 * into an array so callers can check uniformly with `.includes(...)`/`.some(...)`.
 */
export const uniqueConstraintTargets = (err: Prisma.PrismaClientKnownRequestError): string[] => {
  const target: unknown = err.meta?.target;
  if (Array.isArray(target)) {
    return target.filter((t): t is string => typeof t === 'string');
  }
  if (typeof target === 'string') {
    return [target];
  }
  return [];
};

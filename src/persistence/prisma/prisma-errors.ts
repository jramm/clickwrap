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

/** Strips the surrounding double-quotes Postgres puts around quoted identifiers. */
const stripQuotes = (value: string): string => value.replace(/^"(.*)"$/, '$1');

/**
 * Field names + constraint name of a unique violation, normalized into a flat string array so
 * callers can check uniformly with `.includes(...)`/`.some(...)`.
 *
 * The source of this information changed with the move to Prisma 7 + the pg driver adapter:
 *
 * - **Prisma ≤6 (binary engine):** schema-known uniques reported `meta.target` (field-name array);
 *   constraints Prisma did not know from its schema (our raw partial index from
 *   partial-indexes.sql) reported `meta.constraint` (the raw DB name as a string).
 * - **Prisma 7 (driver adapter):** neither `meta.target` nor `meta.constraint` is populated. The
 *   underlying DB error is nested under `meta.driverAdapterError.cause`, whose `constraint.fields`
 *   holds the column list (identifiers arrive DOUBLE-QUOTED for our raw index, e.g. `"customerId"`)
 *   and whose `originalMessage` names the violated constraint/index. Verified against a real
 *   Postgres in the integration suite (acceptance.repo.prisma.spec.ts).
 *
 * All shapes are read defensively so the translation keeps working across engine variants.
 */
export const uniqueConstraintTargets = (err: Prisma.PrismaClientKnownRequestError): string[] => {
  const targets: string[] = [];
  const push = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const v of value) if (typeof v === 'string') targets.push(stripQuotes(v));
    } else if (typeof value === 'string') {
      targets.push(stripQuotes(value));
    }
  };

  const meta = err.meta as Record<string, unknown> | undefined;

  // Prisma ≤6 / non-adapter engines.
  push(meta?.target);
  push(meta?.constraint);

  // Prisma 7 driver adapters: dig into the nested DB error.
  const cause = (meta?.driverAdapterError as { cause?: unknown } | undefined)?.cause;
  if (cause && typeof cause === 'object') {
    const constraint = (cause as { constraint?: unknown }).constraint;
    if (constraint && typeof constraint === 'object') {
      push((constraint as { fields?: unknown }).fields); // { fields: ['"customerId"', …] }
      push((constraint as { index?: unknown }).index); // { index: 'name' }
    } else {
      push(constraint); // raw string name
    }
    // The Postgres 23505 message always names the violated constraint/index — parse it as a
    // stable fallback independent of the adapter's internal `constraint` object shape.
    const message = (cause as { originalMessage?: unknown }).originalMessage;
    if (typeof message === 'string') {
      const match = message.match(/constraint "([^"]+)"/);
      if (match) targets.push(match[1]);
    }
  }

  return targets;
};

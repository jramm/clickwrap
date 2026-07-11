/**
 * Pins the P2002 `meta` shape parsing across Prisma engine variants. The behavioural end-to-end
 * translation (ALREADY_ACCEPTED vs INVALID_STATE) is verified against real Postgres in
 * acceptance.repo.prisma.spec.ts; this fast unit suite locks `uniqueConstraintTargets` against the
 * concrete error shapes so a future engine/adapter bump that changes the shape fails loudly here.
 */
import { Prisma } from '@prisma/client';
import { isUniqueConstraintError, uniqueConstraintTargets } from './prisma-errors';

const p2002 = (meta: Record<string, unknown>): Prisma.PrismaClientKnownRequestError =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
    meta,
  });

describe('uniqueConstraintTargets', () => {
  it('detects P2002 as a unique-constraint error', () => {
    expect(isUniqueConstraintError(p2002({}))).toBe(true);
    expect(isUniqueConstraintError(new Error('nope'))).toBe(false);
  });

  it('Prisma ≤6 binary engine: reads meta.target (field array)', () => {
    expect(uniqueConstraintTargets(p2002({ target: ['customerId', 'versionId'] }))).toEqual(
      expect.arrayContaining(['customerId', 'versionId']),
    );
  });

  it('Prisma ≤6 binary engine: reads meta.constraint (raw index name string)', () => {
    expect(
      uniqueConstraintTargets(p2002({ constraint: 'Acceptance_customerId_versionId_effective_key' })),
    ).toContain('Acceptance_customerId_versionId_effective_key');
  });

  it('Prisma 7 pg adapter: reads the raw partial index from driverAdapterError.cause (quoted fields + message)', () => {
    // Exact shape captured from @prisma/adapter-pg 7.x against real Postgres.
    const targets = uniqueConstraintTargets(
      p2002({
        modelName: 'Acceptance',
        driverAdapterError: {
          name: 'DriverAdapterError',
          cause: {
            originalCode: '23505',
            originalMessage:
              'duplicate key value violates unique constraint "Acceptance_customerId_versionId_effective_key"',
            kind: 'UniqueConstraintViolation',
            constraint: { fields: ['"customerId"', '"versionId"'] },
          },
        },
      }),
    );
    // Column identifiers are de-quoted so the pair check in acceptance.repo.ts matches.
    expect(targets).toEqual(expect.arrayContaining(['customerId', 'versionId']));
    // The constraint name is recovered from the DB message as a stable fallback.
    expect(targets).toContain('Acceptance_customerId_versionId_effective_key');
  });

  it('Prisma 7 pg adapter: reads a primary-key violation (fields: ["id"])', () => {
    const targets = uniqueConstraintTargets(
      p2002({
        modelName: 'Acceptance',
        driverAdapterError: {
          name: 'DriverAdapterError',
          cause: {
            originalCode: '23505',
            originalMessage: 'duplicate key value violates unique constraint "Acceptance_pkey"',
            kind: 'UniqueConstraintViolation',
            constraint: { fields: ['id'] },
          },
        },
      }),
    );
    expect(targets).toContain('id');
  });

  it('returns an empty array when no constraint info is present', () => {
    expect(uniqueConstraintTargets(p2002({}))).toEqual([]);
  });
});

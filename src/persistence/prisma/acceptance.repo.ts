/**
 * Prisma implementation of AcceptanceRepo. Semantics exactly like
 * src/persistence/inmemory/acceptance.repo.ts:
 * - `append` is append-only (no upsert): a second row with the same id is a
 *   programming error (P2002 on the PK) → DomainError('INVALID_STATE', …), analogous to
 *   the Map.has check in the fake. The business rule "exactly one effective acceptance per
 *   (customerId, versionId)" is NOT checked here in code, but enforced by the DB
 *   itself via the partial unique index from prisma/partial-indexes.sql (this could not be
 *   verified against a real Postgres instance in this environment) — a violation also
 *   comes back as P2002 and is translated into DomainError('ALREADY_ACCEPTED', …).
 * - `supersede` is the only permitted correction operation (UPDATE isEffective=false +
 *   supersededByAcceptanceId) — see the note in prisma/partial-indexes.sql about the
 *   column-scoped GRANT exception from the otherwise append-only REVOKE.
 *
 * Important note on translating the partial index (see also prisma-errors.ts): Prisma does not
 * know the index from partial-indexes.sql from its own schema (it cannot be mapped declaratively,
 * see the schema.prisma header comment) and therefore does not return `meta.target` for it as a
 * field array, but as the raw DB constraint name (string). The detection below therefore also
 * checks for a name fragment ("effective") instead of only a field array — this is a best effort
 * that could not yet be verified against a real Postgres instance (see docs/PERSISTENCE.md).
 */
import { Injectable } from '@nestjs/common';
import { DomainError } from '../../common/errors';
import type { AcceptanceRepo } from '../../domain/ports';
import type { Acceptance } from '../../domain/types';
import { toCreateData, toDomain } from './mappers/acceptance.mapper';
import { isRecordNotFoundError, isUniqueConstraintError, uniqueConstraintTargets } from './prisma-errors';
import { PrismaService } from './prisma.service';

/** Name of the partial unique index from prisma/partial-indexes.sql. */
const PARTIAL_EFFECTIVE_INDEX_NAME = 'Acceptance_customerId_versionId_effective_key';

@Injectable()
export class PrismaAcceptanceRepo implements AcceptanceRepo {
  constructor(private readonly prisma: PrismaService) {}

  async append(acceptance: Acceptance): Promise<Acceptance> {
    try {
      const row = await this.prisma.acceptance.create({ data: toCreateData(acceptance) });
      return toDomain(row);
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        const targets = uniqueConstraintTargets(err);
        if (targets.includes(PARTIAL_EFFECTIVE_INDEX_NAME) || targets.some((t) => t.toLowerCase().includes('effective'))) {
          throw new DomainError(
            'ALREADY_ACCEPTED',
            `An effective acceptance already exists for (${acceptance.customerId}, ${acceptance.versionId})`,
          );
        }
        if (targets.includes('id')) {
          throw new DomainError('INVALID_STATE', `Acceptance ${acceptance.id} already exists (append-only)`);
        }
      }
      throw err;
    }
  }

  async supersede(acceptanceId: string, byAcceptanceId: string): Promise<Acceptance> {
    try {
      const row = await this.prisma.acceptance.update({
        where: { id: acceptanceId },
        data: { isEffective: false, supersededByAcceptanceId: byAcceptanceId },
      });
      return toDomain(row);
    } catch (err) {
      if (isRecordNotFoundError(err)) {
        throw new DomainError('INVALID_STATE', `Acceptance ${acceptanceId} does not exist`);
      }
      throw err;
    }
  }

  async findById(id: string): Promise<Acceptance | undefined> {
    const row = await this.prisma.acceptance.findUnique({ where: { id } });
    return row ? toDomain(row) : undefined;
  }

  async findEffective(customerId: string, versionId: string): Promise<Acceptance | undefined> {
    const row = await this.prisma.acceptance.findFirst({ where: { customerId, versionId, isEffective: true } });
    return row ? toDomain(row) : undefined;
  }

  async findEffectiveByVersion(versionId: string): Promise<Acceptance[]> {
    const rows = await this.prisma.acceptance.findMany({ where: { versionId, isEffective: true } });
    return rows.map(toDomain);
  }

  async findByCustomer(customerId: string): Promise<Acceptance[]> {
    const rows = await this.prisma.acceptance.findMany({ where: { customerId }, orderBy: { acceptedAt: 'asc' } });
    return rows.map(toDomain);
  }
}

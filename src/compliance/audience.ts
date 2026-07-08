/**
 * Validation of the optional `audience` query parameter — shared by
 * ComplianceService and PendingAgreementsService. Audiences are dynamic entities, so the
 * value is checked against the AudienceRepo instead of a hardcoded enum.
 */
import { DomainError } from '../common/errors';
import type { AudienceRepo } from '../domain/ports';

/**
 * Missing parameter: no restriction (aggregation across all roles).
 * Unknown audience key: UNKNOWN_AUDIENCE (422).
 */
export const resolveAudienceKey = async (
  audiences: AudienceRepo,
  audienceKey?: string,
): Promise<string | undefined> => {
  if (audienceKey === undefined) {
    return undefined;
  }
  const known = await audiences.findByKey(audienceKey);
  if (!known) {
    throw new DomainError('UNKNOWN_AUDIENCE', `Unknown audience: ${audienceKey}`);
  }
  return audienceKey;
};

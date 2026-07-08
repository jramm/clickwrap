/**
 * Shared helpers for the dynamic entity keys (document type keys, audience keys).
 * Pure functions: no Nest/Prisma imports (CONVENTIONS: domain is pure).
 */
import { DomainError } from '../common/errors';

/** URL-safe slug: lowercase letters, digits and hyphens, 2–32 characters. */
export const ENTITY_KEY_PATTERN = /^[a-z0-9-]{2,32}$/;

export const isValidEntityKey = (key: string): boolean => ENTITY_KEY_PATTERN.test(key);

/** Rejects keys that are not URL-safe slugs (INVALID_STATE, 422). */
export const assertValidEntityKey = (key: string, label: string): void => {
  if (!isValidEntityKey(key)) {
    throw new DomainError(
      'INVALID_STATE',
      `Invalid ${label} key "${key}" — expected a slug matching ${ENTITY_KEY_PATTERN.source}`,
    );
  }
};

/**
 * Compliance/overview detail key per (document type, audience): `TYPE_AUDIENCE`, uppercased.
 * Collision-free because entity keys are slugs (they never contain `_`); hyphens inside a
 * key are kept as-is (folding them into `_` would reintroduce collisions).
 */
export const detailKey = (typeKey: string, audienceKey: string): string =>
  `${typeKey}_${audienceKey}`.toUpperCase();

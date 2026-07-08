/**
 * Rules around hosted acceptance links (channel LINK).
 * Pure functions; node:crypto is allowed (no Nest/Prisma). Evidence-chain principles:
 *  - the raw URL token is a capability and is NEVER persisted — only its SHA-256;
 *  - the signer identity on the hosted page is SELF-DECLARED (typed by the recipient) and is
 *    therefore always marked as such in the acceptance evidence (actor userId `link:<linkId>` +
 *    evidenceNote), never presented as a verified portal identity.
 */
import { createHmac, randomBytes } from 'node:crypto';
import { sha256Hex } from './consent-rules';
import type { AcceptanceLink } from './types';

export const DEFAULT_LINK_EXPIRY_DAYS = 30;
export const MAX_LINK_EXPIRY_DAYS = 365;

/** URL token: 32 random bytes, base64url (43 chars, no padding). */
export const newAcceptanceLinkToken = (): string => randomBytes(32).toString('base64url');

/**
 * Deterministic URL token for a customer's ONE permanent acceptance link. Derived via HMAC from a
 * server secret + the customer id so the same URL can be re-injected into every rollout/reminder
 * mail without ever persisting the raw token (only its {@link acceptanceLinkTokenHash} is stored,
 * exactly like standard links). Security trade-off (see docs/INTEGRATION.md): the link is a
 * permanent capability — leaking the secret makes all permanent tokens derivable; the link stays
 * revocable and only its hash is stored at rest.
 */
export const permanentAcceptanceLinkToken = (secret: string, customerId: string): string =>
  createHmac('sha256', secret).update(`acceptance-link:permanent:${customerId}`).digest('base64url');

/** Lookup/storage key of a link — the raw token never touches the database. */
export const acceptanceLinkTokenHash = (token: string): string => sha256Hex(token);

/**
 * A link is usable only while it is neither revoked nor expired. PERMANENT links never expire
 * (no `expiresAt`); STANDARD links are usable until `expiresAt`. Callers must render the SAME
 * uniform 404 for "unknown token" and "known but unusable" — never reveal which case it was.
 */
export const isAcceptanceLinkUsable = (link: AcceptanceLink, now: Date): boolean => {
  if (link.revokedAt !== undefined) {
    return false;
  }
  if (link.kind === 'PERMANENT') {
    return true;
  }
  return link.expiresAt !== undefined && now.getTime() < link.expiresAt.getTime();
};

/** Actor userId for everything recorded through a link — attributable to the link, not a portal user. */
export const acceptanceLinkActorUserId = (linkId: string): string => `link:${linkId}`;

/** Evidence note stored on every LINK acceptance: the identity is self-declared, not verified. */
export const acceptanceLinkEvidenceNote = (linkId: string): string =>
  `identity self-declared via acceptance link ${linkId}`;

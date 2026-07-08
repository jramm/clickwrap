import {
  acceptanceLinkActorUserId,
  acceptanceLinkEvidenceNote,
  acceptanceLinkTokenHash,
  isAcceptanceLinkUsable,
  newAcceptanceLinkToken,
  permanentAcceptanceLinkToken,
} from './acceptance-links';
import { sha256Hex } from './consent-rules';
import { anAcceptanceLink } from './testing/fixtures';

describe('newAcceptanceLinkToken', () => {
  it('is 32 random bytes as base64url (43 chars, URL-safe alphabet, no padding)', () => {
    const token = newAcceptanceLinkToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('never repeats (capability token)', () => {
    const tokens = new Set(Array.from({ length: 100 }, () => newAcceptanceLinkToken()));
    expect(tokens.size).toBe(100);
  });
});

describe('acceptanceLinkTokenHash', () => {
  it('is the plain SHA-256 hex of the raw token (the raw token is never persisted)', () => {
    expect(acceptanceLinkTokenHash('abc')).toBe(sha256Hex('abc'));
  });
});

describe('permanentAcceptanceLinkToken', () => {
  it('is deterministic per (secret, customer) so the same URL can be reused across mails', () => {
    const a = permanentAcceptanceLinkToken('secret', 'c-1');
    const b = permanentAcceptanceLinkToken('secret', 'c-1');
    expect(a).toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('differs per customer and per secret', () => {
    expect(permanentAcceptanceLinkToken('secret', 'c-1')).not.toBe(
      permanentAcceptanceLinkToken('secret', 'c-2'),
    );
    expect(permanentAcceptanceLinkToken('secret-a', 'c-1')).not.toBe(
      permanentAcceptanceLinkToken('secret-b', 'c-1'),
    );
  });
});

describe('isAcceptanceLinkUsable', () => {
  const now = new Date('2026-07-08T12:00:00Z');

  it('usable: not revoked and before expiresAt', () => {
    const link = anAcceptanceLink({ expiresAt: new Date('2026-07-09T00:00:00Z') });
    expect(isAcceptanceLinkUsable(link, now)).toBe(true);
  });

  it('expired: expiresAt reached → unusable', () => {
    const link = anAcceptanceLink({ expiresAt: now });
    expect(isAcceptanceLinkUsable(link, now)).toBe(false);
  });

  it('revoked → unusable regardless of expiry', () => {
    const link = anAcceptanceLink({
      expiresAt: new Date('2026-08-01T00:00:00Z'),
      revokedAt: new Date('2026-07-01T00:00:00Z'),
    });
    expect(isAcceptanceLinkUsable(link, now)).toBe(false);
  });

  it('PERMANENT link never expires — usable even far in the future', () => {
    const link = anAcceptanceLink({ kind: 'PERMANENT', expiresAt: undefined });
    expect(isAcceptanceLinkUsable(link, new Date('2099-01-01T00:00:00Z'))).toBe(true);
  });

  it('revoked PERMANENT link → unusable', () => {
    const link = anAcceptanceLink({
      kind: 'PERMANENT',
      expiresAt: undefined,
      revokedAt: new Date('2026-07-01T00:00:00Z'),
    });
    expect(isAcceptanceLinkUsable(link, now)).toBe(false);
  });
});

describe('link evidence identifiers', () => {
  it('actor userId is attributable to the link, not to a portal user', () => {
    expect(acceptanceLinkActorUserId('al-7')).toBe('link:al-7');
  });

  it('the evidence note marks the identity as self-declared', () => {
    expect(acceptanceLinkEvidenceNote('al-7')).toBe('identity self-declared via acceptance link al-7');
  });
});

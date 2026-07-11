import { DomainError } from '../common/errors.js';
import {
  assertCustomerHasRole,
  assertDisplayedConsentTextMatches,
  assertDraftMutable,
  assertMethodChannelAllowed,
  assertVersionCurrent,
  consentTextHashFor,
  sha256Hex,
  validateForPublish,
} from './consent-rules.js';
import { aCustomer, aVersion, anActiveVersion } from './testing/fixtures.js';
import type { AcceptanceChannel, AcceptanceMethod } from './types.js';

const expectDomainError = (fn: () => unknown, code: string): void => {
  try {
    fn();
    fail(`expected DomainError ${code}, but no error was thrown`);
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe(code);
  }
};

describe('assertMethodChannelAllowed — allowed combinations', () => {
  it.each<[AcceptanceMethod, AcceptanceChannel]>([
    ['ACTIVE_CONSENT', 'PORTAL'],
    ['ACTIVE_CONSENT', 'ADMIN'],
    ['ACTIVE_CONSENT', 'LINK'], // hosted acceptance page (self-declared signer)
    ['IMPORT', 'ADMIN'],
    ['TACIT', 'SYSTEM'],
  ])('allows %s × %s', (method, channel) => {
    expect(() => assertMethodChannelAllowed(method, channel)).not.toThrow();
  });

  it.each<[AcceptanceMethod, AcceptanceChannel]>([
    ['TACIT', 'PORTAL'],
    ['TACIT', 'ADMIN'],
    ['TACIT', 'LINK'], // tacit acceptance is never attributed to the hosted page
    ['IMPORT', 'PORTAL'],
    ['IMPORT', 'SYSTEM'],
    ['IMPORT', 'LINK'], // out-of-band imports stay an admin-only channel
    ['ACTIVE_CONSENT', 'SYSTEM'],
  ])('rejects %s × %s → INVALID_STATE', (method, channel) => {
    expectDomainError(() => assertMethodChannelAllowed(method, channel), 'INVALID_STATE');
  });
});

describe('sha256Hex / consentTextHashFor', () => {
  it('sha256Hex returns the well-known SHA-256 of "abc"', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('consentTextHashFor hashes the server-side consentText of the version (format sha256:…)', () => {
    const version = anActiveVersion({ consentText: 'abc' });
    expect(consentTextHashFor(version)).toBe(
      'sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('consentTextHashFor without consentText → CONSENT_TEXT_REQUIRED', () => {
    expectDomainError(() => consentTextHashFor(anActiveVersion({ consentText: undefined })), 'CONSENT_TEXT_REQUIRED');
  });
});

describe('assertDisplayedConsentTextMatches — cross-check of the client display', () => {
  const version = anActiveVersion({ consentText: 'I agree.' });

  it('exact match is ok', () => {
    expect(() => assertDisplayedConsentTextMatches(version, 'I agree.')).not.toThrow();
  });

  it('deviation → CONSENT_TEXT_MISMATCH', () => {
    expectDomainError(() => assertDisplayedConsentTextMatches(version, 'I agree'), 'CONSENT_TEXT_MISMATCH');
  });

  it('a whitespace deviation is a mismatch too (the exact text is the evidence basis)', () => {
    expectDomainError(() => assertDisplayedConsentTextMatches(version, ' I agree. '), 'CONSENT_TEXT_MISMATCH');
  });
});

describe('assertVersionCurrent', () => {
  const NOW = new Date('2026-07-07T09:00:00Z');
  const FUTURE = new Date('2026-08-01T00:00:00Z');

  it('current version is ok', () => {
    const current = aVersion({ id: 'v-2' });
    expect(() => assertVersionCurrent(aVersion({ id: 'v-2' }), current, NOW)).not.toThrow();
  });

  it('outdated revision → VERSION_NOT_CURRENT', () => {
    expectDomainError(() => assertVersionCurrent(aVersion({ id: 'v-1' }), aVersion({ id: 'v-2' }), NOW), 'VERSION_NOT_CURRENT');
  });

  it('no applicable current revision exists → VERSION_NOT_CURRENT', () => {
    expectDomainError(() => assertVersionCurrent(aVersion({ id: 'v-1' }), undefined, NOW), 'VERSION_NOT_CURRENT');
  });

  it('upcoming (PUBLISHED, validFrom in the future) is ok — advance acceptance is valid', () => {
    const upcoming = aVersion({ id: 'v-next', status: 'PUBLISHED', validFrom: FUTURE });
    expect(() => assertVersionCurrent(upcoming, aVersion({ id: 'v-2' }), NOW)).not.toThrow();
  });

  it('upcoming is ok even when no current revision exists yet (first scheduled publish)', () => {
    const upcoming = aVersion({ id: 'v-next', status: 'PUBLISHED', validFrom: FUTURE });
    expect(() => assertVersionCurrent(upcoming, undefined, NOW)).not.toThrow();
  });

  it('a DRAFT with future validFrom is NOT acceptable → VERSION_NOT_CURRENT', () => {
    const draft = aVersion({ id: 'v-draft', status: 'DRAFT', validFrom: FUTURE });
    expectDomainError(() => assertVersionCurrent(draft, aVersion({ id: 'v-2' }), NOW), 'VERSION_NOT_CURRENT');
  });

  it('a RETIRED version with past validFrom stays rejected → VERSION_NOT_CURRENT', () => {
    const retired = aVersion({ id: 'v-old', status: 'RETIRED' });
    expectDomainError(() => assertVersionCurrent(retired, aVersion({ id: 'v-2' }), NOW), 'VERSION_NOT_CURRENT');
  });
});

describe('assertCustomerHasRole', () => {
  it('customer with a matching role is ok', () => {
    expect(() => assertCustomerHasRole(aCustomer({ roles: ['customer'] }), 'customer')).not.toThrow();
  });

  it('missing role → ROLE_MISMATCH', () => {
    expectDomainError(() => assertCustomerHasRole(aCustomer({ roles: ['customer'] }), 'partner'), 'ROLE_MISMATCH');
  });
});

describe('validateForPublish', () => {
  it('a valid PASSIVE draft is publishable', () => {
    expect(() => validateForPublish(aVersion({ status: 'DRAFT', objectionPeriodDays: 14 }))).not.toThrow();
  });

  it('a valid ACTIVE draft with consentText + hardDeadlineAt is publishable (gracePeriodDays no longer required)', () => {
    expect(() =>
      validateForPublish(anActiveVersion({ status: 'DRAFT', gracePeriodDays: undefined })),
    ).not.toThrow();
  });

  it('ACTIVE without hardDeadlineAt → INVALID_STATE (an absolute deadline is required)', () => {
    expectDomainError(
      () => validateForPublish(anActiveVersion({ status: 'DRAFT', hardDeadlineAt: undefined })),
      'INVALID_STATE',
    );
  });

  it('ACTIVE with hardDeadlineAt earlier than validFrom → INVALID_STATE', () => {
    expectDomainError(
      () =>
        validateForPublish(
          anActiveVersion({
            status: 'DRAFT',
            validFrom: new Date('2026-08-01T00:00:00Z'),
            hardDeadlineAt: new Date('2026-07-15T00:00:00Z'),
          }),
        ),
      'INVALID_STATE',
    );
  });

  it('ACTIVE with hardDeadlineAt == validFrom is allowed (boundary)', () => {
    const at = new Date('2026-08-01T00:00:00Z');
    expect(() =>
      validateForPublish(anActiveVersion({ status: 'DRAFT', validFrom: at, hardDeadlineAt: at })),
    ).not.toThrow();
  });

  it('PASSIVE must not set hardDeadlineAt → INVALID_STATE', () => {
    expectDomainError(
      () => validateForPublish(aVersion({ status: 'DRAFT', objectionPeriodDays: 14, hardDeadlineAt: new Date('2026-08-01T00:00:00Z') })),
      'INVALID_STATE',
    );
  });

  it('missing changeSummary → CHANGE_SUMMARY_REQUIRED', () => {
    expectDomainError(() => validateForPublish(aVersion({ status: 'DRAFT', changeSummary: '' })), 'CHANGE_SUMMARY_REQUIRED');
  });

  it('whitespace-only changeSummary → CHANGE_SUMMARY_REQUIRED', () => {
    expectDomainError(() => validateForPublish(aVersion({ status: 'DRAFT', changeSummary: '   ' })), 'CHANGE_SUMMARY_REQUIRED');
  });

  it('ACTIVE without consentText → CONSENT_TEXT_REQUIRED', () => {
    expectDomainError(
      () => validateForPublish(anActiveVersion({ status: 'DRAFT', consentText: undefined })),
      'CONSENT_TEXT_REQUIRED',
    );
  });

  it('ACTIVE with blank consentText → CONSENT_TEXT_REQUIRED', () => {
    expectDomainError(
      () => validateForPublish(anActiveVersion({ status: 'DRAFT', consentText: '  ' })),
      'CONSENT_TEXT_REQUIRED',
    );
  });

  it('PASSIVE without consentText is ok', () => {
    expect(() => validateForPublish(aVersion({ status: 'DRAFT', consentText: undefined }))).not.toThrow();
  });

  it('PASSIVE without objectionPeriodDays → INVALID_STATE (deadline would be indeterminable)', () => {
    expectDomainError(
      () => validateForPublish(aVersion({ status: 'DRAFT', objectionPeriodDays: undefined })),
      'INVALID_STATE',
    );
  });

  it.each(['PUBLISHED', 'RETIRED'] as const)('publish on %s → VERSION_IMMUTABLE', (status) => {
    expectDomainError(() => validateForPublish(aVersion({ status })), 'VERSION_IMMUTABLE');
  });
});

describe('assertDraftMutable — DRAFT-only mutations', () => {
  it('DRAFT is mutable', () => {
    expect(() => assertDraftMutable(aVersion({ status: 'DRAFT' }))).not.toThrow();
  });

  it.each(['PUBLISHED', 'RETIRED'] as const)('%s → VERSION_IMMUTABLE', (status) => {
    expectDomainError(() => assertDraftMutable(aVersion({ status })), 'VERSION_IMMUTABLE');
  });
});

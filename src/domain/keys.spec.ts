import { assertValidEntityKey, detailKey, isValidEntityKey } from './keys';

describe('entity keys', () => {
  it.each(['ab', 'customer', 'end-user', 'a1', 'x'.repeat(32)])('accepts %j', (key) => {
    expect(isValidEntityKey(key)).toBe(true);
  });

  it.each(['', 'a', 'A', 'Customer', 'has space', 'under_score', 'café', 'x'.repeat(33)])(
    'rejects %j',
    (key) => {
      expect(isValidEntityKey(key)).toBe(false);
    },
  );

  it('assertValidEntityKey throws INVALID_STATE with the label in the message', () => {
    expect(() => assertValidEntityKey('NOT OK', 'audience')).toThrow(/audience key "NOT OK"/);
    try {
      assertValidEntityKey('NOT OK', 'audience');
      fail('expected DomainError');
    } catch (err) {
      expect(err).toMatchObject({ code: 'INVALID_STATE' });
    }
  });
});

describe('detailKey', () => {
  it('joins type and audience keys uppercased with an underscore', () => {
    expect(detailKey('dpa', 'customer')).toBe('DPA_CUSTOMER');
    expect(detailKey('terms', 'partner')).toBe('TERMS_PARTNER');
  });

  it('keeps hyphens inside keys (collision-free because slugs never contain underscores)', () => {
    expect(detailKey('terms', 'end-user')).toBe('TERMS_END-USER');
    expect(detailKey('terms-end', 'user')).toBe('TERMS-END_USER');
    expect(detailKey('terms', 'end-user')).not.toBe(detailKey('terms-end', 'user'));
  });
});

import { definePlugin, isClickwrapPlugin, PLUGIN_DI_TOKENS } from './plugin';

const validEmailPlugin = {
  kind: 'email-provider' as const,
  key: 'acme',
  create: () => ({ send: async () => ({ providerRef: 'acme-1' }) }),
};

describe('definePlugin', () => {
  it('returns a frozen plugin object with the given shape', () => {
    const plugin = definePlugin(validEmailPlugin);
    expect(plugin.kind).toBe('email-provider');
    expect(plugin.key).toBe('acme');
    expect(Object.isFrozen(plugin)).toBe(true);
  });

  it('rejects an unknown kind', () => {
    expect(() =>
      definePlugin({ ...validEmailPlugin, kind: 'webhooks' } as unknown as Parameters<typeof definePlugin>[0]),
    ).toThrow(/kind/);
  });

  it('rejects a key that is not a slug', () => {
    for (const key of ['', 'Ac me', 'UPPER', '-leading', 'trailing space ']) {
      expect(() => definePlugin({ ...validEmailPlugin, key })).toThrow(/key/);
    }
  });

  it('accepts slug keys with dashes and digits', () => {
    expect(definePlugin({ ...validEmailPlugin, key: 'google-sso-2' }).key).toBe('google-sso-2');
  });

  it('rejects a missing create function', () => {
    expect(() => definePlugin({ ...validEmailPlugin, create: undefined as never })).toThrow(/create/);
  });
});

describe('isClickwrapPlugin', () => {
  it('accepts a definePlugin result', () => {
    expect(isClickwrapPlugin(definePlugin(validEmailPlugin))).toBe(true);
  });

  it('accepts a plain object with the same shape (plugins need not import the SDK)', () => {
    expect(isClickwrapPlugin({ kind: 'file-storage', key: 's3', create: () => ({}) })).toBe(true);
  });

  it('accepts a customer-source plugin', () => {
    expect(
      isClickwrapPlugin({
        kind: 'customer-source',
        key: 'metergrid',
        create: () => ({ fetchAll: async () => ({ customers: [] }) }),
      }),
    ).toBe(true);
  });

  it('rejects non-plugin values', () => {
    for (const value of [undefined, null, 42, 'plugin', {}, { kind: 'email-provider' }, { ...validEmailPlugin, kind: 'nope' }]) {
      expect(isClickwrapPlugin(value)).toBe(false);
    }
  });
});

describe('PLUGIN_DI_TOKENS', () => {
  it('uses string tokens so externally installed plugins can @Inject them without symbol identity', () => {
    for (const token of Object.values(PLUGIN_DI_TOKENS)) {
      expect(typeof token).toBe('string');
      expect(token.startsWith('clickwrap:')).toBe(true);
    }
  });
});

import type { PluginContext } from '../../plugin-sdk';
import { MainPortalCustomerSource } from '../customer-source/mainportal/mainportal.source';
import { PluginRegistry } from '../registry/plugin-registry';
import { mainportalCustomerSourcePlugin } from './mainportal-customer-source.plugin';

/** Builds a PluginContext over an explicit env map (empty values count as unset, like the host). */
const contextFor = (env: Record<string, string | undefined>): PluginContext => {
  const read = (name: string): string | undefined => {
    const value = env[name];
    return value === undefined || value === '' ? undefined : value;
  };
  return {
    env: (name, fallback) => read(name) ?? fallback,
    requireEnv: (name) => {
      const value = read(name);
      if (value === undefined) throw new Error(`${name} is required by the active customer-source plugin "mainportal"`);
      return value;
    },
    logger: { log: () => {}, warn: () => {}, error: () => {} },
  };
};

describe('mainportal customer-source built-in', () => {
  it('is a registered, selectable customer-source plugin (alongside none + metergrid)', () => {
    const registry = PluginRegistry.bootstrap({ appRoot: process.cwd(), pluginPaths: [] });
    expect(registry.keys('customer-source')).toEqual(expect.arrayContaining(['none', 'metergrid', 'mainportal']));
    const plugin = registry.select('customer-source', 'mainportal', 'CUSTOMER_SOURCE');
    expect(plugin.kind).toBe('customer-source');
    expect(plugin.key).toBe('mainportal');
  });

  it('creates a MainPortalCustomerSource from env (default provider-groups path applied)', () => {
    const source = mainportalCustomerSourcePlugin.create(
      contextFor({ MAINPORTAL_BASE_URL: 'https://app.example.test', MAINPORTAL_API_TOKEN: 'token' }),
    );
    expect(source).toBeInstanceOf(MainPortalCustomerSource);
  });

  it('throws a descriptive config error when the base URL is missing', () => {
    expect(() => mainportalCustomerSourcePlugin.create(contextFor({ MAINPORTAL_API_TOKEN: 'token' }))).toThrow(
      /MAINPORTAL_BASE_URL is required.*mainportal/,
    );
  });

  it('throws a descriptive config error when the API token is missing', () => {
    expect(() =>
      mainportalCustomerSourcePlugin.create(contextFor({ MAINPORTAL_BASE_URL: 'https://app.example.test' })),
    ).toThrow(/MAINPORTAL_API_TOKEN is required.*mainportal/);
  });
});

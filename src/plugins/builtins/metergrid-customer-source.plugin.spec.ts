import type { PluginContext } from '../../plugin-sdk';
import { MetergridCustomerSource } from '../customer-source/metergrid/metergrid.source';
import { PluginRegistry } from '../registry/plugin-registry';
import { metergridCustomerSourcePlugin } from './metergrid-customer-source.plugin';

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
      if (value === undefined) throw new Error(`${name} is required by the active customer-source plugin "metergrid"`);
      return value;
    },
    logger: { log: () => {}, warn: () => {}, error: () => {} },
  };
};

describe('metergrid customer-source built-in', () => {
  it('is a registered, selectable customer-source plugin', () => {
    const registry = PluginRegistry.bootstrap({ appRoot: process.cwd(), pluginPaths: [] });
    expect(registry.keys('customer-source')).toEqual(expect.arrayContaining(['none', 'metergrid']));
    const plugin = registry.select('customer-source', 'metergrid', 'CUSTOMER_SOURCE');
    expect(plugin.kind).toBe('customer-source');
    expect(plugin.key).toBe('metergrid');
  });

  it('creates a MetergridCustomerSource from env (default base URL applied)', () => {
    const source = metergridCustomerSourcePlugin.create(
      contextFor({ METERGRID_USERNAME: 'svc@example.test', METERGRID_PASSWORD: 'pw' }),
    );
    expect(source).toBeInstanceOf(MetergridCustomerSource);
  });

  it('throws a descriptive config error when username is missing', () => {
    expect(() => metergridCustomerSourcePlugin.create(contextFor({ METERGRID_PASSWORD: 'pw' }))).toThrow(
      /METERGRID_USERNAME is required.*metergrid/,
    );
  });

  it('throws a descriptive config error when password is missing', () => {
    expect(() =>
      metergridCustomerSourcePlugin.create(contextFor({ METERGRID_USERNAME: 'svc@example.test' })),
    ).toThrow(/METERGRID_PASSWORD is required.*metergrid/);
  });
});

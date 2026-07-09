import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { definePlugin } from '../../plugin-sdk';
import { PluginRegistry } from './plugin-registry';

/** Writes a plugin package (package.json + index.js) into `dir` and returns the dir. */
const writePluginPackage = (
  dir: string,
  manifest: { kind: string; key: string },
  indexJs = `module.exports.default = {
    kind: ${JSON.stringify(manifest.kind)},
    key: ${JSON.stringify(manifest.key)},
    create: () => ({ send: async () => ({ providerRef: 'x' }) }),
  };`,
): string => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: manifest.key, version: '0.0.0', main: 'index.js', clickwrap: manifest }),
  );
  writeFileSync(join(dir, 'index.js'), indexJs);
  return dir;
};

describe('PluginRegistry', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'clickwrap-registry-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('registers the built-ins for every kind', () => {
    const registry = PluginRegistry.bootstrap({ appRoot: root, pluginPaths: [] });
    expect(registry.keys('email-provider')).toEqual(expect.arrayContaining(['noop', 'postmark', 'smtp']));
    expect(registry.keys('file-storage')).toEqual(expect.arrayContaining(['memory', 'local']));
    expect(registry.keys('admin-auth')).toEqual(expect.arrayContaining(['google-sso', 'static-token', 'supertokens']));
    expect(registry.keys('customer-source')).toEqual(expect.arrayContaining(['none']));
  });

  it('selects the built-in `none` customer-source, which reports an empty snapshot (sync disabled)', async () => {
    const registry = PluginRegistry.bootstrap({ appRoot: root, pluginPaths: [] });
    const plugin = registry.select('customer-source', 'none', 'CUSTOMER_SOURCE');
    expect(plugin.kind).toBe('customer-source');
    const source = plugin.create({
      env: () => undefined,
      requireEnv: () => {
        throw new Error('unused');
      },
      logger: { log: () => {}, warn: () => {}, error: () => {} },
    });
    expect(await source.fetchAll()).toEqual({ customers: [] });
  });

  it('discovers plugins from the app package.json dependencies (node_modules scan)', () => {
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ name: 'app', dependencies: { 'acme-mailer': '1.0.0', rxjs: '^7.0.0' }, devDependencies: {} }),
    );
    // A dependency WITHOUT a clickwrap manifest is ignored.
    mkdirSync(join(root, 'node_modules', 'rxjs'), { recursive: true });
    writeFileSync(join(root, 'node_modules', 'rxjs', 'package.json'), JSON.stringify({ name: 'rxjs', main: 'index.js' }));
    writePluginPackage(join(root, 'node_modules', 'acme-mailer'), { kind: 'email-provider', key: 'acme' });

    const registry = PluginRegistry.bootstrap({ appRoot: root, pluginPaths: [] });
    expect(registry.keys('email-provider')).toContain('acme');
    expect(registry.select('email-provider', 'acme', 'EMAIL_PROVIDER').key).toBe('acme');
  });

  it('loads local plugin dirs from pluginPaths (CLICKWRAP_PLUGIN_PATHS)', () => {
    const dir = writePluginPackage(join(root, 'my-plugin'), { kind: 'email-provider', key: 'dev-mailer' });
    const registry = PluginRegistry.bootstrap({ appRoot: root, pluginPaths: [dir] });
    expect(registry.keys('email-provider')).toContain('dev-mailer');
  });

  it('rejects a duplicate (kind,key) — including clashes with a built-in — as a hard boot error', () => {
    const dir = writePluginPackage(join(root, 'clash'), { kind: 'email-provider', key: 'noop' });
    expect(() => PluginRegistry.bootstrap({ appRoot: root, pluginPaths: [dir] })).toThrow(/duplicate|already registered/i);
  });

  it('rejects a package whose default export is not a plugin', () => {
    const dir = writePluginPackage(join(root, 'broken'), { kind: 'email-provider', key: 'broken' }, 'module.exports = {};');
    expect(() => PluginRegistry.bootstrap({ appRoot: root, pluginPaths: [dir] })).toThrow(/default export/i);
  });

  it('rejects a default export that contradicts the manifest kind/key', () => {
    const dir = writePluginPackage(
      join(root, 'mismatch'),
      { kind: 'email-provider', key: 'mismatch' },
      `module.exports.default = { kind: 'file-storage', key: 'other', create: () => ({}) };`,
    );
    expect(() => PluginRegistry.bootstrap({ appRoot: root, pluginPaths: [dir] })).toThrow(/manifest/i);
  });

  it('rejects an invalid manifest (unknown kind)', () => {
    const dir = writePluginPackage(join(root, 'badkind'), { kind: 'cron', key: 'badkind' });
    expect(() => PluginRegistry.bootstrap({ appRoot: root, pluginPaths: [dir] })).toThrow(/kind/i);
  });

  it('select() throws for an unknown key and lists the available keys', () => {
    const registry = PluginRegistry.bootstrap({ appRoot: root, pluginPaths: [] });
    expect(() => registry.select('email-provider', 'sendgrid', 'EMAIL_PROVIDER')).toThrow(
      /Unknown EMAIL_PROVIDER "sendgrid".*noop/,
    );
  });

  it('register() accepts programmatic plugins through the same duplicate check', () => {
    const registry = new PluginRegistry();
    const plugin = definePlugin({ kind: 'email-provider', key: 'a', create: () => ({ send: async () => ({ providerRef: 'a' }) }) });
    registry.register(plugin, 'test');
    expect(() => registry.register(plugin, 'test')).toThrow(/duplicate|already registered/i);
  });
});

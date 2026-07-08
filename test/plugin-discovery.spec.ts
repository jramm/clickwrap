/**
 * End-to-end proof of the plugin architecture against REAL fixture packages
 * (test/fixtures/plugins/*): discovery via CLICKWRAP_PLUGIN_PATHS, activation via
 * EMAIL_PROVIDER=acme through the full AppModule, and the rejection cases (duplicate key,
 * unknown key, invalid export) as hard boot errors.
 *
 * Env is set BEFORE the dynamic imports (module metadata reads env while it is evaluated — same
 * pattern as test/app.boot.spec.ts); the registry singleton is reset around every test.
 */
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { join } from 'node:path';
import type { EmailDeliveryProvider } from '../src/plugin-sdk';
import { PluginRegistry, resetPluginRegistry } from '../src/plugins/registry/plugin-registry';

const FIXTURES = join(__dirname, 'fixtures', 'plugins');
const ACME_DIR = join(FIXTURES, 'acme-email');

const ENV_KEYS = ['CLICKWRAP_PLUGIN_PATHS', 'EMAIL_PROVIDER', 'REPOSITORY_DRIVER'] as const;

describe('plugin discovery (fixture packages via CLICKWRAP_PLUGIN_PATHS)', () => {
  const saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

  beforeEach(() => {
    resetPluginRegistry();
  });

  afterEach(() => {
    resetPluginRegistry();
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
  });

  it('discovers the acme fixture package and selects it via EMAIL_PROVIDER=acme through the full app', async () => {
    process.env.CLICKWRAP_PLUGIN_PATHS = ACME_DIR;
    process.env.EMAIL_PROVIDER = 'acme';
    process.env.REPOSITORY_DRIVER = 'inmemory';

    const { AppModule } = await import('../src/app.module');
    const { EMAIL_TOKENS } = await import('../src/plugins/email/core/email-delivery-provider');

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app: INestApplication = moduleRef.createNestApplication();
    await app.init();
    try {
      const provider = app.get<EmailDeliveryProvider>(EMAIL_TOKENS.EmailDeliveryProvider);
      await expect(provider.send({ to: 'jane@customer.example', subject: 's', text: 't' })).resolves.toEqual({
        providerRef: 'acme-1-jane@customer.example',
      });
    } finally {
      await app.close();
    }
  });

  it('duplicate (kind,key) — fixture clashing with the built-in noop — is a hard boot error', () => {
    process.env.CLICKWRAP_PLUGIN_PATHS = join(FIXTURES, 'duplicate-noop');
    expect(() => PluginRegistry.bootstrap()).toThrow(/Duplicate plugin \(email-provider, "noop"\)/);
  });

  it('a fixture whose default export is not a plugin is a hard boot error', () => {
    process.env.CLICKWRAP_PLUGIN_PATHS = join(FIXTURES, 'invalid-export');
    expect(() => PluginRegistry.bootstrap()).toThrow(/default export is not a clickwrap plugin/);
  });

  it('an unknown EMAIL_PROVIDER key fails the boot listing the available keys (incl. discovered ones)', async () => {
    process.env.CLICKWRAP_PLUGIN_PATHS = ACME_DIR;
    process.env.EMAIL_PROVIDER = 'sendgrid';
    const { EmailModule } = await import('../src/plugins/email/email.module');
    expect(() => EmailModule.forRoot()).toThrow(/Unknown EMAIL_PROVIDER "sendgrid".*acme.*noop/);
  });
});

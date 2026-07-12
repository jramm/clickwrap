import { AcceptAssetsModule } from './accept-assets.module.js';

describe('AcceptAssetsModule.forRootFromEnv', () => {
  const original = process.env.ACCEPT_ASSETS_DIR;
  afterEach(() => {
    if (original === undefined) delete process.env.ACCEPT_ASSETS_DIR;
    else process.env.ACCEPT_ASSETS_DIR = original;
  });

  it('is a no-op module when ACCEPT_ASSETS_DIR is unset', () => {
    delete process.env.ACCEPT_ASSETS_DIR;
    const mod = AcceptAssetsModule.forRootFromEnv();
    expect(mod.module).toBe(AcceptAssetsModule);
    expect(mod.imports ?? []).toHaveLength(0);
  });

  it('serves the configured dir under /accept-assets when set', () => {
    process.env.ACCEPT_ASSETS_DIR = '/app/plugins/mg-ui/dist/client';
    const mod = AcceptAssetsModule.forRootFromEnv();
    expect(mod.imports).toHaveLength(1);
    expect(AcceptAssetsModule.serveRoot).toBe('/accept-assets');
  });
});

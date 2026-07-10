/**
 * The built-in `default` acceptance-page renderer: it is registered like every other plugin,
 * selectable via ACCEPTANCE_PAGE, and byte-for-byte delegates to the existing accept-page view
 * (so the current server-rendered page is unchanged).
 */
import type { AcceptancePageView } from '../../../plugin-sdk';
import { renderAcceptPage, renderLinkNotFoundPage } from '../../../accept/accept-page.view';
import { builtinPlugins } from '../../builtins';
import { PluginRegistry } from '../../registry/plugin-registry';
import { DefaultAcceptancePageRenderer } from './default-acceptance-page.renderer';

const aView = (): AcceptancePageView => ({
  linkId: 'al-1',
  customerName: 'Acme GmbH',
  firstName: 'Jane',
  lastName: 'Doe',
  companyName: 'Acme GmbH',
  suggestedEmail: 'jane@acme.example',
  items: [],
});

describe('acceptance-page built-in registration', () => {
  it('ships an acceptance-page plugin with key "default"', () => {
    const plugin = builtinPlugins.find((p) => p.kind === 'acceptance-page');
    expect(plugin?.key).toBe('default');
  });

  it('is selectable through the registry as an acceptance-page plugin', () => {
    const registry = PluginRegistry.bootstrap({ pluginPaths: [] });
    const plugin = registry.select('acceptance-page', 'default', 'ACCEPTANCE_PAGE');
    const renderer = plugin.create({
      env: () => undefined,
      requireEnv: () => {
        throw new Error('unused');
      },
      logger: { log: () => {}, warn: () => {}, error: () => {} },
    });
    expect(typeof renderer.renderAcceptPage).toBe('function');
    expect(typeof renderer.renderNotFoundPage).toBe('function');
  });

  it('an unknown ACCEPTANCE_PAGE key is a boot error listing the available keys', () => {
    const registry = PluginRegistry.bootstrap({ pluginPaths: [] });
    expect(() => registry.select('acceptance-page', 'mg-ui', 'ACCEPTANCE_PAGE')).toThrow(
      /Unknown ACCEPTANCE_PAGE "mg-ui".*default/,
    );
  });
});

describe('DefaultAcceptancePageRenderer', () => {
  const renderer = new DefaultAcceptancePageRenderer();

  it('renderAcceptPage delegates to the existing accept-page view (identical output)', () => {
    const view = aView();
    expect(renderer.renderAcceptPage(view, 'en')).toBe(renderAcceptPage(view, 'en'));
    expect(renderer.renderAcceptPage(view, 'de')).toBe(renderAcceptPage(view, 'de'));
  });

  it('renderNotFoundPage delegates to the existing link-not-found view', () => {
    expect(renderer.renderNotFoundPage('en')).toBe(renderLinkNotFoundPage('en'));
    expect(renderer.renderNotFoundPage('de')).toBe(renderLinkNotFoundPage('de'));
  });
});

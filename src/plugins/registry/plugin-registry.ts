/**
 * Bootstrap-time plugin discovery and lookup.
 *
 * Sources, all funneled through the same `register()` (duplicate (kind,key) = hard boot error):
 *  1. **Built-ins** (`src/plugins/builtins/`) — declared with the same `definePlugin` shape as
 *     external plugins; no special path.
 *  2. **Installed dependencies**: every entry of the app package.json `dependencies` +
 *     `devDependencies` whose own package.json carries the `"clickwrap"` manifest field.
 *  3. **`CLICKWRAP_PLUGIN_PATHS`**: comma-separated local directories (each with a package.json +
 *     main entry) — for development and test fixtures.
 *
 * The module main entry must default-export a plugin matching the manifest's kind/key
 * (validated structurally — see `isClickwrapPlugin`). Every loaded plugin is logged one-line.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Logger } from '@nestjs/common';
import {
  type AnyClickwrapPlugin,
  type ClickwrapPlugin,
  type ClickwrapPluginKind,
  type ClickwrapPluginManifest,
  CLICKWRAP_PLUGIN_KINDS,
  isClickwrapPlugin,
  isPluginKind,
} from '../../plugin-sdk';
import { builtinPlugins } from '../builtins';

export interface PluginRegistryOptions {
  /** App root containing package.json + node_modules. Default: process.cwd(). */
  appRoot?: string;
  /** Plugins registered before any discovery. Default: the built-ins. */
  builtins?: AnyClickwrapPlugin[];
  /** Local plugin directories. Default: CLICKWRAP_PLUGIN_PATHS (comma-separated). */
  pluginPaths?: string[];
}

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  clickwrap?: unknown;
}

const readPackageJson = (dir: string): PackageJson | undefined => {
  const path = join(dir, 'package.json');
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, 'utf8')) as PackageJson;
};

const parseManifest = (raw: unknown, origin: string): ClickwrapPluginManifest => {
  const manifest = raw as { kind?: unknown; key?: unknown };
  if (typeof raw !== 'object' || raw === null || !isPluginKind(manifest.kind) || typeof manifest.key !== 'string') {
    throw new Error(
      `Invalid "clickwrap" manifest in ${origin} — expected { kind: ${CLICKWRAP_PLUGIN_KINDS.join(' | ')}, key: "<slug>" }`,
    );
  }
  return { kind: manifest.kind, key: manifest.key };
};

/** Requires the package main entry of `dir` and validates its default export against the manifest. */
const loadPluginFromDir = (dir: string, manifest: ClickwrapPluginManifest): AnyClickwrapPlugin => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod: unknown = require(dir);
  const candidate =
    typeof mod === 'object' && mod !== null && 'default' in mod ? (mod as { default: unknown }).default : mod;
  if (!isClickwrapPlugin(candidate)) {
    throw new Error(
      `Plugin package at ${dir}: the main entry's default export is not a clickwrap plugin ` +
        '(expected the definePlugin shape { kind, key, create, module? })',
    );
  }
  if (candidate.kind !== manifest.kind || candidate.key !== manifest.key) {
    throw new Error(
      `Plugin package at ${dir}: default export (${candidate.kind}/${candidate.key}) contradicts the ` +
        `package.json manifest (${manifest.kind}/${manifest.key})`,
    );
  }
  return candidate;
};

export class PluginRegistry {
  private readonly logger = new Logger('PluginRegistry');
  private readonly plugins = new Map<ClickwrapPluginKind, Map<string, AnyClickwrapPlugin>>();

  /** Builds the registry from built-ins + installed dependencies + CLICKWRAP_PLUGIN_PATHS. */
  static bootstrap(options: PluginRegistryOptions = {}): PluginRegistry {
    const registry = new PluginRegistry();
    const appRoot = options.appRoot ?? process.cwd();
    for (const plugin of options.builtins ?? builtinPlugins) {
      registry.register(plugin, 'builtin');
    }
    registry.discoverDependencies(appRoot);
    const pluginPaths =
      options.pluginPaths ??
      (process.env.CLICKWRAP_PLUGIN_PATHS ?? '')
        .split(',')
        .map((path) => path.trim())
        .filter((path) => path.length > 0);
    for (const path of pluginPaths) {
      registry.loadPath(resolve(appRoot, path));
    }
    return registry;
  }

  register(plugin: AnyClickwrapPlugin, source: string): void {
    const byKey = this.plugins.get(plugin.kind) ?? new Map<string, AnyClickwrapPlugin>();
    if (byKey.has(plugin.key)) {
      throw new Error(
        `Duplicate plugin (${plugin.kind}, "${plugin.key}") from ${source} — the (kind, key) pair is already registered`,
      );
    }
    byKey.set(plugin.key, plugin);
    this.plugins.set(plugin.kind, byKey);
    this.logger.log(`loaded ${plugin.kind} plugin "${plugin.key}" (${source})`);
  }

  keys(kind: ClickwrapPluginKind): string[] {
    return [...(this.plugins.get(kind)?.keys() ?? [])].sort();
  }

  /** Resolves the plugin selected by an env var; unknown key = boot error listing the options. */
  select<K extends ClickwrapPluginKind>(kind: K, key: string, envVar: string): ClickwrapPlugin<K> {
    const plugin = this.plugins.get(kind)?.get(key);
    if (!plugin) {
      throw new Error(`Unknown ${envVar} "${key}" — available ${kind} plugins: ${this.keys(kind).join(', ')}`);
    }
    return plugin as ClickwrapPlugin<K>;
  }

  /** Scans dependencies + devDependencies of the app package.json for clickwrap manifests. */
  private discoverDependencies(appRoot: string): void {
    const appPackage = readPackageJson(appRoot);
    if (!appPackage) return;
    const names = Object.keys({ ...appPackage.dependencies, ...appPackage.devDependencies });
    for (const name of names) {
      const dir = join(appRoot, 'node_modules', name);
      const pkg = readPackageJson(dir);
      if (!pkg || pkg.clickwrap === undefined) continue;
      const manifest = parseManifest(pkg.clickwrap, `package "${name}"`);
      this.register(loadPluginFromDir(dir, manifest), `package ${name}`);
    }
  }

  /** Loads one CLICKWRAP_PLUGIN_PATHS entry (a directory with package.json + main entry). */
  private loadPath(dir: string): void {
    const pkg = readPackageJson(dir);
    if (!pkg || pkg.clickwrap === undefined) {
      throw new Error(`CLICKWRAP_PLUGIN_PATHS entry ${dir} has no package.json with a "clickwrap" manifest`);
    }
    const manifest = parseManifest(pkg.clickwrap, dir);
    this.register(loadPluginFromDir(dir, manifest), `path ${dir}`);
  }
}

let singleton: PluginRegistry | undefined;

/** The app-wide registry, bootstrapped lazily on first use (module metadata evaluation time). */
export const getPluginRegistry = (): PluginRegistry => (singleton ??= PluginRegistry.bootstrap());

/** Test seam: force a fresh bootstrap (e.g. after changing CLICKWRAP_PLUGIN_PATHS). */
export const resetPluginRegistry = (): void => {
  singleton = undefined;
};

/**
 * Bootstrap-time plugin discovery and lookup.
 *
 * Sources, all funneled through the same `register()` (duplicate (kind,key) = hard boot error):
 *  1. **Built-ins** (`src/plugins/builtins/`) — declared with the same `definePlugin` shape as
 *     external plugins; no special path.
 *  2. **Installed dependencies**: every entry of the app package.json `dependencies` +
 *     `devDependencies` whose own package.json carries the `"clickwrap"` manifest field.
 *  3. **`CLICKWRAP_PLUGIN_PATHS`**: comma-separated local plugin directories (each a package.json +
 *     main entry), loaded explicitly by path.
 *  4. **`CLICKWRAP_PLUGIN_DIR`**: comma-separated directories that are SCANNED (default scan dir
 *     `/app/plugins` in the container images). Two layouts are picked up, so no per-plugin config
 *     and no rebuild are needed:
 *       - immediate subdirectories carrying a `"clickwrap"` manifest — the "drop-in" case (mount a
 *         volume of plugin folders);
 *       - a `node_modules` under the scan dir — so a PUBLISHED plugin package is consumed with
 *         `npm install --prefix <scanDir> @scope/plugin` (the package + its deps land here).
 *     Entries without a manifest are ignored; a missing scan dir is a no-op.
 *
 * The module main entry must default-export a plugin matching the manifest's kind/key
 * (validated structurally — see `isClickwrapPlugin`). Every loaded plugin is logged one-line.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { Logger } from '@nestjs/common';

// The registry is bootstrapped synchronously at NestJS module-metadata evaluation time, so plugin
// loading must stay synchronous. Under ESM there is no ambient `require`; createRequire gives a
// CommonJS require (main/exports/index resolution intact) that loads a plugin package's entry
// synchronously — a dynamic `import()` would force the whole discovery path (and its callers up to
// module metadata) to become async.
const require = createRequire(import.meta.url);
import {
  type AnyClickwrapPlugin,
  type ClickwrapPlugin,
  type ClickwrapPluginKind,
  type ClickwrapPluginManifest,
  CLICKWRAP_PLUGIN_KINDS,
  isClickwrapPlugin,
  isPluginKind,
} from '../../plugin-sdk/index.js';
import { builtinPlugins } from '../builtins/index.js';

export interface PluginRegistryOptions {
  /** App root containing package.json + node_modules. Default: process.cwd(). */
  appRoot?: string;
  /** Plugins registered before any discovery. Default: the built-ins. */
  builtins?: AnyClickwrapPlugin[];
  /** Local plugin directories loaded by path. Default: CLICKWRAP_PLUGIN_PATHS (comma-separated). */
  pluginPaths?: string[];
  /** Directories to SCAN for plugin subdirs. Default: CLICKWRAP_PLUGIN_DIR (comma-separated). */
  pluginDirs?: string[];
}

const splitEnvList = (value: string | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

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
    const pluginPaths = options.pluginPaths ?? splitEnvList(process.env.CLICKWRAP_PLUGIN_PATHS);
    for (const path of pluginPaths) {
      registry.loadPath(resolve(appRoot, path));
    }
    const pluginDirs = options.pluginDirs ?? splitEnvList(process.env.CLICKWRAP_PLUGIN_DIR);
    for (const dir of pluginDirs) {
      registry.scanDir(resolve(appRoot, dir));
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

  /**
   * Scans `dir` for immediate subdirectories that carry a "clickwrap" manifest and loads each one
   * (drop-in plugins, e.g. a mounted /app/plugins volume). Subdirectories without a manifest are
   * ignored; a missing/!directory scan dir is a no-op. A subdir WITH a (broken) manifest still fails
   * loudly via loadPath — a declared plugin that cannot load should not be silently skipped.
   */
  private scanDir(dir: string): void {
    if (!existsSync(dir) || !statSync(dir).isDirectory()) {
      this.logger.log(`plugin scan dir ${dir} not present — skipping`);
      return;
    }
    // (a) immediate subdirectories that are themselves plugin packages (drop-in source/built dirs).
    for (const name of readdirSync(dir)) {
      this.loadIfPlugin(join(dir, name));
    }
    // (b) an npm-installed layout under <dir>/node_modules — so consuming a PUBLISHED plugin package
    //     is just `npm install --prefix <dir> @scope/plugin` (no source clone, no rebuild); the
    //     package and its deps land here and are picked up. Scoped packages nest one level deeper.
    const nodeModules = join(dir, 'node_modules');
    if (existsSync(nodeModules) && statSync(nodeModules).isDirectory()) {
      for (const name of readdirSync(nodeModules)) {
        if (name.startsWith('.')) continue; // .bin, .package-lock.json, etc.
        const entry = join(nodeModules, name);
        if (name.startsWith('@') && statSync(entry).isDirectory()) {
          for (const scoped of readdirSync(entry)) this.loadIfPlugin(join(entry, scoped));
        } else {
          this.loadIfPlugin(entry);
        }
      }
    }
  }

  /** Loads `dir` as a plugin iff it carries a "clickwrap" manifest; otherwise ignores it. */
  private loadIfPlugin(dir: string): void {
    const pkg = readPackageJson(dir);
    if (!pkg || pkg.clickwrap === undefined) return;
    this.loadPath(dir);
  }
}

let singleton: PluginRegistry | undefined;

/** The app-wide registry, bootstrapped lazily on first use (module metadata evaluation time). */
export const getPluginRegistry = (): PluginRegistry => (singleton ??= PluginRegistry.bootstrap());

/** Test seam: force a fresh bootstrap (e.g. after changing CLICKWRAP_PLUGIN_PATHS). */
export const resetPluginRegistry = (): void => {
  singleton = undefined;
};

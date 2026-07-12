// Builds the publishable @jramm/clickwrap-plugin-sdk package into sdk-dist/.
//
// The SDK's single source of truth stays src/plugin-sdk/ (the host imports it relatively); this
// script compiles that source to a standalone package (ESM + .d.ts) and writes a publish-ready
// package.json. Usage:  node scripts/build-sdk.mjs [version]  (default: root package.json version).
import { execSync } from 'node:child_process';
import { copyFileSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const rootPkg = JSON.parse(readFileSync('package.json', 'utf8'));
const version = (process.argv[2] || rootPkg.version).replace(/^v/, '');

rmSync('sdk-dist', { recursive: true, force: true });
execSync('node_modules/.bin/tsc -p tsconfig.sdk.json', { stdio: 'inherit' });

const pkg = {
  name: '@jramm/clickwrap-plugin-sdk',
  version,
  description:
    'Plugin SDK for clickwrap-server: definePlugin + the plugin-kind contracts (email-provider, ' +
    'file-storage, admin-auth, acceptance-page, admin-notification).',
  license: 'Apache-2.0',
  type: 'module',
  main: './index.js',
  types: './index.d.ts',
  exports: { '.': { types: './index.d.ts', default: './index.js' } },
  files: ['**/*.js', '**/*.d.ts', 'README.md', 'LICENSE'],
  repository: { type: 'git', url: 'git+https://github.com/jramm/clickwrap.git', directory: 'src/plugin-sdk' },
  // Only needed by plugins that ship a module() (controllers/jobs); the type import is erased at
  // runtime, so plugins without one need no dependency at all.
  peerDependencies: { '@nestjs/common': '>=11' },
  peerDependenciesMeta: { '@nestjs/common': { optional: true } },
  publishConfig: { registry: 'https://npm.pkg.github.com' },
  engines: { node: '>=20' },
};
writeFileSync('sdk-dist/package.json', `${JSON.stringify(pkg, null, 2)}\n`);
copyFileSync('src/plugin-sdk/README.md', 'sdk-dist/README.md');
copyFileSync('LICENSE', 'sdk-dist/LICENSE');
console.log(`Built ${pkg.name}@${version} into sdk-dist/`);

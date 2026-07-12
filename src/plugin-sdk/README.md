# clickwrap-server plugin SDK

Contracts for third-party clickwrap-server plugins: the package manifest, `definePlugin`, and the
interfaces of the three plugin kinds (`email-provider`, `file-storage`, `admin-auth`).

**Published as [`@jramm/clickwrap-plugin-sdk`](https://github.com/jramm/clickwrap/pkgs/npm/clickwrap-plugin-sdk)**
on GitHub Packages, so plugin authors can depend on the types without vendoring this repo. Install
it with a one-line `.npmrc` for the `@jramm` scope:

```
# .npmrc
@jramm:registry=https://npm.pkg.github.com
```
```bash
npm i -D @jramm/clickwrap-plugin-sdk @nestjs/common   # @nestjs/common only if your plugin ships a module()
```

The source of truth stays in this directory; the package is built from it (`scripts/build-sdk.mjs`)
and published by the release workflow on a `v*` tag. Why it stays cleanly extractable:

- It has **zero imports from the rest of `src/`** — no domain types, no persistence, no host
  services. Keep it that way; the host imports FROM the SDK, never the other way around.
- Its only external touchpoint is a **type-only** import of `DynamicModule` from `@nestjs/common`
  (erased at compile time). Plugins that ship a `module()` need `@nestjs/common` as a peer
  dependency; plugins without controllers/jobs need no dependencies at all.
- DI tokens (`PLUGIN_DI_TOKENS`) are **strings**, not symbols, so an externally installed plugin
  can inject host-bound services without sharing a symbol instance with the host.
- Plugins do not even need the SDK at runtime: the host validates default exports structurally
  (`isClickwrapPlugin`), so a plain object of the `definePlugin` shape works. The SDK's value is
  type safety and early validation.

The plugin author guide (manifest, discovery, activation, examples) lives in
[`docs/PLUGINS.md`](../../docs/PLUGINS.md).

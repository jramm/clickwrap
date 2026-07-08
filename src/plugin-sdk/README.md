# clickwrap-server plugin SDK

Contracts for third-party clickwrap-server plugins: the package manifest, `definePlugin`, and the
interfaces of the three plugin kinds (`email-provider`, `file-storage`, `admin-auth`).

**This directory is prepared for extraction as a published npm package** (working title
`@clickwrap/plugin-sdk`) so plugin authors can depend on the types without vendoring this repo:

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

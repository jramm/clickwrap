// Registers the ts-node ESM loader via the stable module.register() API (Node ≥20.6), used by the
// Nest-booting dev/tooling scripts (start:dev, seed-example, openapi). ts-node runs the real
// TypeScript compiler, so emitDecoratorMetadata produces correct design:paramtypes — unlike
// esbuild/tsx, whose incomplete metadata breaks NestJS class-based (non-@Inject) DI.
// Using --import with this shim avoids the deprecated --loader flag.
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register('ts-node/esm', pathToFileURL('./'));

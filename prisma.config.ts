/**
 * Prisma 7 configuration.
 *
 * Prisma 7 removed the `url` field from the `datasource` block in schema.prisma.
 * The connection URL used by the CLI (migrate / db push / studio) now lives here.
 * At runtime the PrismaClient connects via a driver adapter (@prisma/adapter-pg),
 * wired up in src/persistence/prisma/prisma.service.ts — see docs/PERSISTENCE.md.
 */
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// `prisma generate` (run on install via the postinstall hook, and in the backend/spec-drift CI
// jobs that never touch a database) must not require a live DATABASE_URL. We therefore read the
// URL from the environment with a harmless localhost fallback instead of `env('DATABASE_URL')`,
// which throws when the variable is unset. Commands that actually connect (db push, migrate,
// studio, and the runtime pg adapter) still get the real value from .env / the environment.
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://clickwrap:clickwrap@localhost:5432/clickwrap';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: DATABASE_URL,
  },
});

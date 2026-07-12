import { Logger } from '@nestjs/common';

/**
 * Dev-convenience env defaults + safety warnings, applied once at boot as a side effect —
 * imported from main.ts / the seed script AFTER `dotenv/config` and BEFORE AppModule is evaluated
 * (plugins read env while the Nest container is constructed). Keeps a from-scratch local run to a
 * minimum of required config WITHOUT weakening production: real secrets are never defaulted here,
 * only flagged.
 */
const logger = new Logger('env');

// PUBLIC_BASE_URL — absolute base for hosted acceptance links and /files + document URLs. Default
// to localhost:PORT so a local run works out of the box; production MUST set it, otherwise those
// links point at localhost.
if (!(process.env.PUBLIC_BASE_URL ?? '').trim()) {
  const port = (process.env.PORT ?? '').trim() || '3000';
  process.env.PUBLIC_BASE_URL = `http://localhost:${port}`;
  logger.warn(
    `PUBLIC_BASE_URL is not set — defaulting to ${process.env.PUBLIC_BASE_URL} (fine for local dev). ` +
      'Set it to the real public URL in production, or acceptance/document links will point at localhost.',
  );
}

// Placeholder auth tokens: fine for dev/CI, a footgun in production.
for (const name of ['ADMIN_API_TOKEN', 'SERVICE_API_TOKEN']) {
  if ((process.env[name] ?? '').trim() === 'change-me') {
    logger.warn(`${name} is still the default "change-me" — set a real secret in production.`);
  }
}

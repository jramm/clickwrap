/**
 * Generates the committed OpenAPI specs (repo root):
 *
 *   pnpm openapi   →  openapi.admin.json + openapi.integration.json
 *
 * Boots the full AppModule with the in-memory driver (no Postgres, no listen) and
 * EMAIL_PROVIDER=postmark so the webhook route is part of the integration spec. Environment is
 * pinned explicitly AFTER dotenv so a local .env can never change the committed output.
 */
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

process.env.REPOSITORY_DRIVER = 'inmemory';
process.env.EMAIL_PROVIDER = 'postmark';
process.env.POSTMARK_API_TOKEN = ''; // noop client — nothing is sent
process.env.EMAIL_FROM = 'openapi@example.invalid'; // required by the postmark provider factory
process.env.FILE_STORAGE = 'memory';
process.env.ADMIN_AUTH = 'google-sso,static-token';
process.env.CLICKWRAP_PLUGIN_PATHS = ''; // local dev plugins must never leak into the committed specs
process.env.SWEEPER_ENABLED = 'false';

async function main(): Promise<void> {
  // Dynamic imports AFTER the env is pinned — AppModule/EmailModule read env while their
  // module metadata is evaluated.
  const { NestFactory } = await import('@nestjs/core');
  const { AppModule } = await import('../src/app.module');
  const { buildAdminDocument, buildIntegrationDocument } = await import('../src/common/openapi/build-documents');

  const app = await NestFactory.create(AppModule, { logger: false });
  await app.init();

  const root = join(__dirname, '..');
  const documents = [
    { file: 'openapi.admin.json', document: buildAdminDocument(app) },
    { file: 'openapi.integration.json', document: buildIntegrationDocument(app) },
  ];
  for (const { file, document } of documents) {
    writeFileSync(join(root, file), `${JSON.stringify(document, null, 2)}\n`);
    const paths = Object.keys(document.paths);
    const operations = paths.reduce((count, path) => count + Object.keys(document.paths[path]).length, 0);
    console.log(`${file}: ${paths.length} paths, ${operations} operations`);
  }

  await app.close();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

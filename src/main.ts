// Load .env FIRST — module metadata (RepositoryModule.forRoot, EmailModule.forRoot) reads env
// while the imports below are evaluated. Without this, `cp .env.example .env` (README quick
// start) silently had no effect.
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await configureApp(app);
  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();

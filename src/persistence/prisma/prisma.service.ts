/**
 * NestJS wrapper around PrismaClient — this service's only connection to the database.
 * Standard lifecycle recipe (Prisma docs): $connect on module start, $disconnect on module
 * destroy, plus enableShutdownHooks(app) in case the process itself terminates (SIGTERM/SIGINT
 * are resolved by Nest via app.close(); this hook ensures that a Prisma-side "beforeExit" also
 * leads to a clean app.close()).
 */
import { INestApplication, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  /** Establishes the DB connection on Nest module start. */
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  /** Closes the DB connection on Nest module destroy (e.g. in tests, `app.close()`). */
  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /** Closes the Nest app on a process exit signal so that onModuleDestroy/$disconnect takes effect. */
  async enableShutdownHooks(app: INestApplication): Promise<void> {
    process.on('beforeExit', () => {
      void app.close();
    });
  }
}

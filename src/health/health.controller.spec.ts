import { ServiceUnavailableException } from '@nestjs/common';
import type { PrismaService } from '../persistence/prisma/prisma.service.js';
import { HealthController } from './health.controller.js';

describe('HealthController', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  describe('GET /health (liveness)', () => {
    it('returns ok without touching the database', () => {
      // No PrismaService injected — liveness must never depend on it.
      const body = new HealthController().live();
      expect(body).toMatchObject({ status: 'ok', service: 'clickwrap-server' });
      expect(typeof body.uptime).toBe('number');
      expect(() => new Date(body.timestamp).toISOString()).not.toThrow();
    });
  });

  describe('GET /health/ready (readiness)', () => {
    it('in-memory driver → ready without a DB check', async () => {
      process.env.REPOSITORY_DRIVER = 'inmemory';
      const controller = new HealthController();
      await expect(controller.ready()).resolves.toEqual({ status: 'ready', database: 'skipped' });
    });

    it('prisma driver → pings the DB and reports it up', async () => {
      process.env.REPOSITORY_DRIVER = 'prisma';
      const queryRaw = jest.fn().mockResolvedValue([{ '?column?': 1 }]);
      const controller = new HealthController({ $queryRaw: queryRaw } as unknown as PrismaService);
      await expect(controller.ready()).resolves.toEqual({ status: 'ready', database: 'up' });
      expect(queryRaw).toHaveBeenCalledTimes(1);
    });

    it('prisma driver → 503 when the DB is unreachable', async () => {
      process.env.REPOSITORY_DRIVER = 'prisma';
      const queryRaw = jest.fn().mockRejectedValue(new Error('connection refused'));
      const controller = new HealthController({ $queryRaw: queryRaw } as unknown as PrismaService);
      await expect(controller.ready()).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('prisma driver but no client bound → ready (skipped) rather than crashing', async () => {
      process.env.REPOSITORY_DRIVER = 'prisma';
      const controller = new HealthController(); // @Optional() prisma undefined
      await expect(controller.ready()).resolves.toEqual({ status: 'ready', database: 'skipped' });
    });
  });
});

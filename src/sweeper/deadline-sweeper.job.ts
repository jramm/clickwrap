import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ActivationSweeperService } from './activation-sweeper.service.js';
import { DeadlineSweeperService } from './deadline-sweeper.service.js';

/**
 * Thin cron registration (hourly) — the actual logic, testable without Nest, lives in the
 * services. The activation sweep runs FIRST: once a scheduled version has become effective, the
 * predecessor's open states are SUPERSEDED before the deadline pass could TACIT-book them —
 * SUPERSEDED never TACIT holds across the flip.
 */
@Injectable()
export class DeadlineSweeperJob {
  constructor(
    private readonly activationSweeperService: ActivationSweeperService,
    private readonly sweeperService: DeadlineSweeperService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async run(): Promise<void> {
    await this.activationSweeperService.run();
    await this.sweeperService.run();
  }
}

import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { RolloutNotificationService } from './rollout-notification.service.js';

/**
 * Cron registration for the rollout-notification sweeper. Runs every 30s so publish-rollout e-mails
 * go out promptly (publish itself no longer sends them). Reentrancy-guarded: a slow batch (many or
 * large sends) must not overlap the next tick. The logic lives in RolloutNotificationService.run().
 */
@Injectable()
export class RolloutNotificationJob {
  private running = false;

  constructor(private readonly service: RolloutNotificationService) {}

  @Cron(CronExpression.EVERY_30_SECONDS)
  async run(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      await this.service.run();
    } finally {
      this.running = false;
    }
  }
}

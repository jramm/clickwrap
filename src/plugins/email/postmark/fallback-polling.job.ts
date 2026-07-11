import { Inject, Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { Clock } from '../../../domain/clock.js';
import { TOKENS } from '../../../persistence/tokens.js';
import { DeliveryEventService } from '../core/delivery-event.service.js';

/** Sends only count as "open" for fallback polling once they are at least this old. */
const FALLBACK_STALE_AFTER_MINUTES = 10;
const MS_PER_MINUTE = 60_000;

/**
 * Fallback polling: every 10 minutes re-check open sends without a webhook
 * event via the provider's fetchDeliveryStatus. Thin cron registration only — the actual logic
 * (testable without Nest) lives in DeliveryEventService.pollPendingDeliveries. Registered only when
 * EMAIL_PROVIDER=postmark (the only provider with delivery tracking).
 */
@Injectable()
export class FallbackPollingJob {
  constructor(
    private readonly deliveryEvents: DeliveryEventService,
    @Inject(TOKENS.Clock) private readonly clock: Clock,
  ) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async run(): Promise<void> {
    const cutoff = new Date(this.clock.now().getTime() - FALLBACK_STALE_AFTER_MINUTES * MS_PER_MINUTE);
    await this.deliveryEvents.pollPendingDeliveries(cutoff);
  }
}

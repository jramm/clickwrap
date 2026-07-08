import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ReminderService } from './reminder.service';

/** Thin cron registration (daily) — the actual logic, testable without Nest, lives in ReminderService.run(). */
@Injectable()
export class ReminderJob {
  constructor(private readonly reminderService: ReminderService) {}

  @Cron(CronExpression.EVERY_DAY_AT_8AM)
  async run(): Promise<void> {
    await this.reminderService.run();
  }
}

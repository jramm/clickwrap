import { ReminderJob } from './reminder.job';
import type { ReminderService } from './reminder.service';

describe('ReminderJob', () => {
  it('delegates to ReminderService.run()', async () => {
    const reminderService = { run: jest.fn().mockResolvedValue(undefined) };
    const job = new ReminderJob(reminderService as unknown as ReminderService);

    await job.run();

    expect(reminderService.run).toHaveBeenCalledTimes(1);
  });
});

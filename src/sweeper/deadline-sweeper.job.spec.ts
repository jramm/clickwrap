import type { ActivationSweeperService } from './activation-sweeper.service';
import { DeadlineSweeperJob } from './deadline-sweeper.job';
import type { DeadlineSweeperService } from './deadline-sweeper.service';

describe('DeadlineSweeperJob', () => {
  it('runs the activation sweep BEFORE the deadline sweep (SUPERSEDED before TACIT across the flip)', async () => {
    const order: string[] = [];
    const activationService = { run: jest.fn().mockImplementation(async () => order.push('activation')) };
    const sweeperService = { run: jest.fn().mockImplementation(async () => order.push('deadline')) };
    const job = new DeadlineSweeperJob(
      activationService as unknown as ActivationSweeperService,
      sweeperService as unknown as DeadlineSweeperService,
    );

    await job.run();

    expect(activationService.run).toHaveBeenCalledTimes(1);
    expect(sweeperService.run).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['activation', 'deadline']);
  });
});

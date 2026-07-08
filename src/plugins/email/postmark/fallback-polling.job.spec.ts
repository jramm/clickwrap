import { FixedClock } from '../../../domain/clock';
import { FallbackPollingJob } from './fallback-polling.job';
import type { DeliveryEventService } from '../core/delivery-event.service';

describe('FallbackPollingJob', () => {
  it('calls pollPendingDeliveries with the cutoff "now minus 10 minutes"', async () => {
    const deliveryEvents = { pollPendingDeliveries: jest.fn().mockResolvedValue(undefined) };
    const clock = new FixedClock(new Date('2026-07-07T09:10:00Z'));
    const job = new FallbackPollingJob(deliveryEvents as unknown as DeliveryEventService, clock);

    await job.run();

    expect(deliveryEvents.pollPendingDeliveries).toHaveBeenCalledWith(new Date('2026-07-07T09:00:00Z'));
  });
});

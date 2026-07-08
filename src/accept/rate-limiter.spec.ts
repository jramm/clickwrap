import { FixedClock } from '../domain/clock';
import { SlidingWindowRateLimiter } from './rate-limiter';

describe('SlidingWindowRateLimiter', () => {
  it('allows up to the limit within the window, then blocks', () => {
    const limiter = new SlidingWindowRateLimiter(new FixedClock(new Date('2026-07-08T08:00:00Z')), 3, 60_000);
    expect(limiter.allow('k')).toBe(true);
    expect(limiter.allow('k')).toBe(true);
    expect(limiter.allow('k')).toBe(true);
    expect(limiter.allow('k')).toBe(false);
  });

  it('keys are isolated from each other', () => {
    const limiter = new SlidingWindowRateLimiter(new FixedClock(new Date('2026-07-08T08:00:00Z')), 1, 60_000);
    expect(limiter.allow('a')).toBe(true);
    expect(limiter.allow('b')).toBe(true);
    expect(limiter.allow('a')).toBe(false);
  });

  it('hits fall out of the sliding window over time', () => {
    const clock = new FixedClock(new Date('2026-07-08T08:00:00Z'));
    const limiter = new SlidingWindowRateLimiter(clock, 2, 60_000);
    expect(limiter.allow('k')).toBe(true);
    expect(limiter.allow('k')).toBe(true);
    expect(limiter.allow('k')).toBe(false);
    clock.set(new Date('2026-07-08T08:01:01Z'));
    expect(limiter.allow('k')).toBe(true);
  });
});

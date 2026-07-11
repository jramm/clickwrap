import { FixedClock, SystemClock } from './clock.js';

describe('FixedClock', () => {
  it('returns exactly the fixed time', () => {
    const clock = new FixedClock(new Date('2026-07-07T09:00:00Z'));
    expect(clock.now().toISOString()).toBe('2026-07-07T09:00:00.000Z');
  });

  it('returns a copy — mutating the return value does not change the clock', () => {
    const clock = new FixedClock(new Date('2026-07-07T09:00:00Z'));
    clock.now().setUTCFullYear(1999);
    expect(clock.now().toISOString()).toBe('2026-07-07T09:00:00.000Z');
  });

  it('set() moves the time', () => {
    const clock = new FixedClock(new Date('2026-07-07T09:00:00Z'));
    clock.set(new Date('2026-08-01T00:00:00Z'));
    expect(clock.now().toISOString()).toBe('2026-08-01T00:00:00.000Z');
  });

  it('advanceDays() moves forward by exact days (including fractions)', () => {
    const clock = new FixedClock(new Date('2026-07-07T09:00:00Z'));
    clock.advanceDays(14);
    expect(clock.now().toISOString()).toBe('2026-07-21T09:00:00.000Z');
    clock.advanceDays(0.5);
    expect(clock.now().toISOString()).toBe('2026-07-21T21:00:00.000Z');
  });
});

describe('SystemClock', () => {
  it('returns the current system time', () => {
    const before = Date.now();
    const now = new SystemClock().now().getTime();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(Date.now());
  });
});

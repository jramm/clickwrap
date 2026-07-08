/**
 * Time source of the domain. Timestamps for deadlines ALWAYS come from here (server time),
 * never from client payloads.
 */
export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Deterministic clock for tests. */
export class FixedClock implements Clock {
  private currentMs: number;

  constructor(current: Date) {
    this.currentMs = current.getTime();
  }

  now(): Date {
    return new Date(this.currentMs);
  }

  set(date: Date): void {
    this.currentMs = date.getTime();
  }

  advanceDays(days: number): void {
    this.currentMs += days * MS_PER_DAY;
  }
}

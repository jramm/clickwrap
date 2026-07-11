/**
 * Minimal sliding-window rate limiter for the hosted acceptance page (MVP: in-memory,
 * single-node — a multi-node deployment needs a shared store; documented in docs/API.md).
 * Time comes from the injected Clock (deterministic tests, CONVENTIONS.md).
 */
import type { Clock } from '../domain/clock.js';

export const ACCEPT_PAGE_RATE_LIMIT = 20;
export const ACCEPT_PAGE_RATE_WINDOW_MS = 60 * 1000;

export class SlidingWindowRateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly clock: Clock,
    private readonly limit = ACCEPT_PAGE_RATE_LIMIT,
    private readonly windowMs = ACCEPT_PAGE_RATE_WINDOW_MS,
  ) {}

  /** Registers one hit for `key`; false once the limit within the sliding window is exceeded. */
  allow(key: string): boolean {
    const now = this.clock.now().getTime();
    const cutoff = now - this.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((at) => at > cutoff);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }
}

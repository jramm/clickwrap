/**
 * Module-local ports of the consent module (not part of the domain core).
 * Pure interfaces; in-memory impl in ./inmemory.ts. The EscalationLog was consolidated into the
 * shared port src/common/escalation/escalation-log.ts (previously duplicated here + in the
 * Postmark module) — token: ESCALATION_LOG, wiring: RepositoryModule.
 */

/**
 * Idempotency store for writing portal endpoints: same idempotency key → identical response.
 * REPOSITORY_DRIVER=prisma binds the persistent Prisma variant (table IdempotencyRecord);
 * inmemory binds the in-memory variant (does not survive restarts — dev/tests only).
 *
 * putIfAbsent semantics: the caller reserves the key BEFORE processing
 * (`reserve`), then stores the response (`put`) or releases the reservation on failure
 * (`release`). A second request with the same key sees either the finished response (replay)
 * or an in-flight reservation (wait briefly instead of a 409).
 */
export interface IdempotencyStore {
  /** Finished response for the key — `undefined` if unknown OR merely reserved (in processing). */
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  /** Atomic putIfAbsent: true = newly reserved (caller processes), false = already reserved/completed. */
  reserve(key: string): Promise<boolean>;
  /** Releases a reservation WITHOUT a stored response (error path); no-op once a response is stored. */
  release(key: string): Promise<void>;
}

/** ID generation (injectable → deterministic tests). */
export interface IdGenerator {
  next(prefix: string): string;
}

/** DI tokens of the module-local ports (runtime wiring: RepositoryModule or ConsentModule). */
export const CONSENT_TOKENS = {
  IdempotencyStore: Symbol('IdempotencyStore'),
  IdGenerator: Symbol('IdGenerator'),
} as const;

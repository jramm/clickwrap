/**
 * State machine of the CustomerVersionState — pure transition functions.
 * Inputs are never mutated; time comes exclusively from the injected Clock.
 */
import { DomainError } from '../common/errors.js';
import type { Clock } from './clock.js';
import {
  type AcceptanceMethod,
  type AgreementVersion,
  type CustomerVersionState,
} from './types.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const addDays = (base: Date, days: number): Date => new Date(base.getTime() + days * MS_PER_DAY);

/** PASSIVE objection period in days — required (deadline is undeterminable otherwise). */
const objectionPeriodDaysFor = (version: AgreementVersion): number => {
  if (version.objectionPeriodDays === undefined) {
    throw new DomainError('INVALID_STATE', 'PASSIVE version without objectionPeriodDays — deadline cannot be determined');
  }
  return version.objectionPeriodDays;
};

/** The later of the two instants — used to anchor deadlines at the version's validFrom. */
const laterOf = (a: Date, b: Date): Date => (a.getTime() >= b.getTime() ? a : b);

/**
 * Deadline stamped on a freshly created CustomerVersionState at rollout, BEFORE any access.
 * ACTIVE: the version's absolute {@link AgreementVersion.hardDeadlineAt} — every customer must
 * accept by then or is blocked, independent of access. PASSIVE: undefined — the individual
 * objection period is anchored only at provable access (see {@link recordAccess}). Callers that
 * create PENDING_NOTIFICATION states use this to set `deadlineAt`.
 */
export const rolloutDeadlineFor = (version: AgreementVersion): Date | undefined =>
  version.acceptanceMode === 'ACTIVE' ? version.hardDeadlineAt : undefined;

/**
 * Provable access (e-mail delivery or popup display): PENDING_NOTIFICATION → NOTIFIED, sets
 * notifiedAt = server time (evidence). Idempotent: notifiedAt is only set when empty — the first
 * access wins.
 *
 * ACTIVE: the deadline is the version's ABSOLUTE hard deadline, already stamped on the state at
 * rollout (see {@link rolloutDeadlineFor}); access records evidence but NEVER moves it.
 *
 * PASSIVE: the individual objection period starts here — deadlineAt = notifiedAt +
 * objectionPeriodDays, anchored at the version's validFrom (deadlineAt = max(notifiedAt + period,
 * validFrom)) so recipients always get the full window and nothing is TACIT-booked before the
 * version is in effect. Block carry-over: if the predecessor version was blocking, the state
 * blocks immediately — deadlineAt = max(notifiedAt, validFrom).
 */
export const recordAccess = (
  state: CustomerVersionState,
  clock: Clock,
  version: AgreementVersion,
  predecessorWasBlocking = false,
): CustomerVersionState => {
  if (state.state !== 'PENDING_NOTIFICATION' || state.notifiedAt !== undefined) {
    return state;
  }
  const notifiedAt = clock.now();
  if (version.acceptanceMode === 'ACTIVE') {
    // ACTIVE: keep the absolute hard deadline already on the state — access does not move it.
    return { ...state, state: 'NOTIFIED', notifiedAt };
  }
  const base = predecessorWasBlocking ? notifiedAt : addDays(notifiedAt, objectionPeriodDaysFor(version));
  const deadlineAt = laterOf(base, version.validFrom);
  return { ...state, state: 'NOTIFIED', notifiedAt, deadlineAt };
};

const ACCEPTABLE_FROM: readonly CustomerVersionState['state'][] = [
  'PENDING_NOTIFICATION', // manual (back-dated) recording by an admin before access
  'NOTIFIED',
  'EXPIRED_BLOCKING', // late consent lifts the block
  'OBJECTED', // late consent after clarification
];

/**
 * Consent (active or manual admin recording) → ACCEPTED.
 * TACIT is only ever produced by the sweeper (sweep), never by accept.
 */
export const accept = (state: CustomerVersionState, method: AcceptanceMethod): CustomerVersionState => {
  if (method === 'TACIT') {
    throw new DomainError('INVALID_STATE', 'TACIT is only ever produced by the deadline sweeper');
  }
  if (state.state === 'ACCEPTED') {
    throw new DomainError('ALREADY_ACCEPTED');
  }
  if (!ACCEPTABLE_FROM.includes(state.state)) {
    throw new DomainError('INVALID_STATE', `Consent from ${state.state} is not possible`);
  }
  return { ...state, state: 'ACCEPTED' };
};

/**
 * Objection — only for PASSIVE versions (ACTIVE, including EXPIRED_BLOCKING, always yields
 * OBJECTION_NOT_APPLICABLE), only from NOTIFIED and only before deadlineAt.
 */
export const object = (
  state: CustomerVersionState,
  version: AgreementVersion,
  clock: Clock,
): CustomerVersionState => {
  if (version.acceptanceMode !== 'PASSIVE') {
    throw new DomainError('OBJECTION_NOT_APPLICABLE', 'No right of objection on ACTIVE versions');
  }
  if (state.state !== 'NOTIFIED') {
    throw new DomainError('INVALID_STATE', `Objection from ${state.state} is not possible`);
  }
  if (state.deadlineAt === undefined || clock.now().getTime() >= state.deadlineAt.getTime()) {
    throw new DomainError('OBJECTION_PERIOD_EXPIRED');
  }
  return { ...state, state: 'OBJECTED' };
};

export type SweepOutcome = 'TACIT_ACCEPTED' | 'EXPIRED_BLOCKING' | 'NOOP';

export interface SweepResult {
  state: CustomerVersionState;
  outcome: SweepOutcome;
}

/** States that a due deadline flips to EXPIRED_BLOCKING for an ACTIVE version. */
const ACTIVE_SWEEPABLE_STATES: readonly CustomerVersionState['state'][] = ['PENDING_NOTIFICATION', 'NOTIFIED'];

/**
 * Deadline sweeper (deadlineAt reached):
 * - ACTIVE: from PENDING_NOTIFICATION OR NOTIFIED → EXPIRED_BLOCKING. This includes
 *   never-accessed PENDING customers: the absolute hard deadline blocks them regardless of access.
 * - PASSIVE: only from NOTIFIED → ACCEPTED (the caller records an Acceptance with method=TACIT);
 *   a PASSIVE PENDING (never accessed) has no deadlineAt and is never swept.
 * Everything else — in particular SUPERSEDED/ACCEPTED/OBJECTED — is a no-op.
 */
export const sweep = (state: CustomerVersionState, version: AgreementVersion, clock: Clock): SweepResult => {
  if (state.deadlineAt === undefined || clock.now().getTime() < state.deadlineAt.getTime()) {
    return { state, outcome: 'NOOP' };
  }
  if (version.acceptanceMode === 'ACTIVE') {
    if (ACTIVE_SWEEPABLE_STATES.includes(state.state)) {
      return { state: { ...state, state: 'EXPIRED_BLOCKING' }, outcome: 'EXPIRED_BLOCKING' };
    }
    return { state, outcome: 'NOOP' };
  }
  if (state.state !== 'NOTIFIED') {
    return { state, outcome: 'NOOP' };
  }
  return { state: { ...state, state: 'ACCEPTED' }, outcome: 'TACIT_ACCEPTED' };
};

export interface SupersedeResult {
  state: CustomerVersionState;
  /** Was the old state EXPIRED_BLOCKING? → block carry-over for the successor version. */
  wasBlocking: boolean;
}

/**
 * New version published (or role revoked): every open state → SUPERSEDED (terminal).
 * ACCEPTED is not an open state and is never superseded (the evidence record remains).
 */
export const supersede = (state: CustomerVersionState): SupersedeResult => {
  if (state.state === 'SUPERSEDED') {
    return { state, wasBlocking: false };
  }
  if (state.state === 'ACCEPTED') {
    throw new DomainError('INVALID_STATE', 'ACCEPTED is never superseded — the evidence record remains');
  }
  return { state: { ...state, state: 'SUPERSEDED' }, wasBlocking: state.state === 'EXPIRED_BLOCKING' };
};

/** Open states in which a block carry-over continues the predecessor's block. */
const CARRY_OVER_BLOCKING_STATES: readonly CustomerVersionState['state'][] = [
  'PENDING_NOTIFICATION',
  'NOTIFIED',
];

/**
 * true for EXPIRED_BLOCKING — and also for carryOverBlocking=true, as long as the successor
 * version has not yet been accepted (a document update does not lift existing blocks: the
 * blocked customer stays blocked immediately after the successor version is published, with no
 * new grace period). ACCEPTED/OBJECTED/SUPERSEDED lift the block resp. end the state.
 */
export const isBlocking = (state: CustomerVersionState): boolean =>
  state.state === 'EXPIRED_BLOCKING' ||
  (state.carryOverBlocking === true && CARRY_OVER_BLOCKING_STATES.includes(state.state));

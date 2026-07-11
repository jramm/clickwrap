import { DomainError } from '../common/errors.js';
import { FixedClock } from './clock.js';
import { accept, isBlocking, object, recordAccess, supersede, sweep } from './state-machine.js';
import { aState, aVersion, anActiveVersion } from './testing/fixtures.js';
import type { CustomerVersionStateValue } from './types.js';

const T0 = new Date('2026-07-07T09:00:00Z');
const clockAt = (date: Date | string): FixedClock => new FixedClock(new Date(date));

const expectDomainError = (fn: () => unknown, code: string): void => {
  try {
    fn();
    fail(`expected DomainError ${code}, but no error was thrown`);
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe(code);
  }
};

describe('recordAccess', () => {
  it('PENDING_NOTIFICATION → NOTIFIED (PASSIVE): sets notifiedAt = server time and deadlineAt = +objectionPeriodDays', () => {
    const result = recordAccess(aState(), clockAt(T0), aVersion({ objectionPeriodDays: 14 }));
    expect(result.state).toBe('NOTIFIED');
    expect(result.notifiedAt).toEqual(T0);
    expect(result.deadlineAt).toEqual(new Date('2026-07-21T09:00:00Z'));
  });

  it('PENDING_NOTIFICATION → NOTIFIED (ACTIVE): sets notifiedAt but keeps the absolute hard deadline (access never moves it)', () => {
    const HARD = new Date('2026-07-15T00:00:00Z');
    const result = recordAccess(aState({ deadlineAt: HARD }), clockAt(T0), anActiveVersion({ hardDeadlineAt: HARD }));
    expect(result.state).toBe('NOTIFIED');
    expect(result.notifiedAt).toEqual(T0);
    expect(result.deadlineAt).toEqual(HARD);
  });

  it('ACTIVE: a never-accessed PENDING with no deadline stamped stays without a deadline after access (rollout stamps it, not access)', () => {
    const result = recordAccess(aState({ deadlineAt: undefined }), clockAt(T0), anActiveVersion());
    expect(result.state).toBe('NOTIFIED');
    expect(result.notifiedAt).toEqual(T0);
    expect(result.deadlineAt).toBeUndefined();
  });

  it('PASSIVE without objectionPeriodDays: DomainError INVALID_STATE (deadline would be indeterminable)', () => {
    expectDomainError(
      () => recordAccess(aState(), clockAt(T0), aVersion({ objectionPeriodDays: undefined })),
      'INVALID_STATE',
    );
  });

  it('is idempotent: notifiedAt is only set when empty — a later access changes nothing', () => {
    const first = recordAccess(aState(), clockAt(T0), aVersion());
    const second = recordAccess(first, clockAt('2026-07-10T12:00:00Z'), aVersion());
    expect(second).toEqual(first);
  });

  it('block carry-over (PASSIVE): predecessorWasBlocking → deadlineAt = notifiedAt (blocking immediately)', () => {
    const result = recordAccess(aState(), clockAt(T0), aVersion(), true);
    expect(result.state).toBe('NOTIFIED');
    expect(result.notifiedAt).toEqual(T0);
    expect(result.deadlineAt).toEqual(T0);
  });

  it.each<CustomerVersionStateValue>(['ACCEPTED', 'OBJECTED', 'EXPIRED_BLOCKING', 'SUPERSEDED'])(
    'no-op from %s (never revives a terminal/decided state)',
    (state) => {
      const input = aState({ state, notifiedAt: undefined, deadlineAt: undefined });
      expect(recordAccess(input, clockAt(T0), aVersion())).toEqual(input);
    },
  );

  it('does not mutate the input state (pure function)', () => {
    const input = aState();
    recordAccess(input, clockAt(T0), aVersion());
    expect(input.state).toBe('PENDING_NOTIFICATION');
    expect(input.notifiedAt).toBeUndefined();
  });

  describe('deadline anchor for not-yet-effective versions (deadlineAt = max(notifiedAt + period, validFrom))', () => {
    const FUTURE_VALID_FROM = new Date('2026-08-01T00:00:00Z');
    const upcoming = (overrides = {}): ReturnType<typeof aVersion> =>
      aVersion({ validFrom: FUTURE_VALID_FROM, objectionPeriodDays: 14, ...overrides });

    it('access long before validFrom (notifiedAt + period < validFrom) → deadlineAt = validFrom', () => {
      // T0 + 14d = 2026-07-21 lies before validFrom 2026-08-01 → the deadline is anchored at validFrom.
      const result = recordAccess(aState(), clockAt(T0), upcoming());
      expect(result.state).toBe('NOTIFIED');
      expect(result.notifiedAt).toEqual(T0);
      expect(result.deadlineAt).toEqual(FUTURE_VALID_FROM);
    });

    it('access shortly before validFrom (notifiedAt + period > validFrom) → deadlineAt = notifiedAt + period (full window)', () => {
      // 2026-07-30 + 14d = 2026-08-13 lands after validFrom → the recipient keeps the full window.
      const result = recordAccess(aState(), clockAt('2026-07-30T00:00:00Z'), upcoming());
      expect(result.deadlineAt).toEqual(new Date('2026-08-13T00:00:00Z'));
    });

    it('access after validFrom behaves exactly as before → deadlineAt = notifiedAt + period', () => {
      const result = recordAccess(aState(), clockAt('2026-08-02T00:00:00Z'), upcoming());
      expect(result.deadlineAt).toEqual(new Date('2026-08-16T00:00:00Z'));
    });

    it('carry-over before validFrom (PASSIVE): deadlineAt = max(notifiedAt, validFrom) — never blocks or expires before validFrom', () => {
      const result = recordAccess(aState(), clockAt(T0), upcoming(), true);
      expect(result.notifiedAt).toEqual(T0);
      expect(result.deadlineAt).toEqual(FUTURE_VALID_FROM);
    });

    it('carry-over after validFrom keeps the immediate-block semantics: deadlineAt = notifiedAt', () => {
      const at = new Date('2026-08-02T00:00:00Z');
      const result = recordAccess(aState(), clockAt(at), upcoming(), true);
      expect(result.deadlineAt).toEqual(at);
    });
  });
});

describe('accept', () => {
  it.each<CustomerVersionStateValue>(['PENDING_NOTIFICATION', 'NOTIFIED', 'EXPIRED_BLOCKING', 'OBJECTED'])(
    '%s → ACCEPTED',
    (state) => {
      const result = accept(aState({ state }), 'ACTIVE_CONSENT');
      expect(result.state).toBe('ACCEPTED');
    },
  );

  it('manual admin recording: IMPORT from PENDING_NOTIFICATION → ACCEPTED', () => {
    expect(accept(aState({ state: 'PENDING_NOTIFICATION' }), 'IMPORT').state).toBe('ACCEPTED');
  });

  it('late consent from EXPIRED_BLOCKING lifts the block', () => {
    const result = accept(aState({ state: 'EXPIRED_BLOCKING' }), 'ACTIVE_CONSENT');
    expect(result.state).toBe('ACCEPTED');
    expect(isBlocking(result)).toBe(false);
  });

  it('from ACCEPTED → DomainError ALREADY_ACCEPTED', () => {
    expectDomainError(() => accept(aState({ state: 'ACCEPTED' }), 'ACTIVE_CONSENT'), 'ALREADY_ACCEPTED');
  });

  it('from SUPERSEDED → DomainError INVALID_STATE (terminal)', () => {
    expectDomainError(() => accept(aState({ state: 'SUPERSEDED' }), 'ACTIVE_CONSENT'), 'INVALID_STATE');
  });

  it('TACIT is only ever produced by the sweeper → DomainError INVALID_STATE', () => {
    expectDomainError(() => accept(aState({ state: 'NOTIFIED' }), 'TACIT'), 'INVALID_STATE');
  });

  it('does not mutate the input state', () => {
    const input = aState({ state: 'NOTIFIED' });
    accept(input, 'ACTIVE_CONSENT');
    expect(input.state).toBe('NOTIFIED');
  });
});

describe('object', () => {
  const notified = (deadline: string): ReturnType<typeof aState> =>
    aState({ state: 'NOTIFIED', notifiedAt: T0, deadlineAt: new Date(deadline) });

  it('PASSIVE + NOTIFIED within the period → OBJECTED', () => {
    const result = object(notified('2026-07-21T09:00:00Z'), aVersion(), clockAt('2026-07-10T00:00:00Z'));
    expect(result.state).toBe('OBJECTED');
  });

  it('ACTIVE version: no right of objection → OBJECTION_NOT_APPLICABLE', () => {
    expectDomainError(
      () => object(notified('2026-07-21T09:00:00Z'), anActiveVersion(), clockAt('2026-07-10T00:00:00Z')),
      'OBJECTION_NOT_APPLICABLE',
    );
  });

  it('ACTIVE + EXPIRED_BLOCKING: cannot object once already blocked → OBJECTION_NOT_APPLICABLE', () => {
    const blocked = aState({ state: 'EXPIRED_BLOCKING', notifiedAt: T0, deadlineAt: new Date('2026-07-21T09:00:00Z') });
    expectDomainError(
      () => object(blocked, anActiveVersion(), clockAt('2026-07-25T00:00:00Z')),
      'OBJECTION_NOT_APPLICABLE',
    );
  });

  it('PASSIVE after the period expired → OBJECTION_PERIOD_EXPIRED', () => {
    expectDomainError(
      () => object(notified('2026-07-21T09:00:00Z'), aVersion(), clockAt('2026-07-22T00:00:00Z')),
      'OBJECTION_PERIOD_EXPIRED',
    );
  });

  it('exactly at deadlineAt the period has already expired (sweeper boundary) → OBJECTION_PERIOD_EXPIRED', () => {
    expectDomainError(
      () => object(notified('2026-07-21T09:00:00Z'), aVersion(), clockAt('2026-07-21T09:00:00Z')),
      'OBJECTION_PERIOD_EXPIRED',
    );
  });

  it.each<CustomerVersionStateValue>(['PENDING_NOTIFICATION', 'ACCEPTED', 'OBJECTED', 'SUPERSEDED'])(
    'from %s → DomainError INVALID_STATE (only NOTIFIED may object)',
    (state) => {
      expectDomainError(
        () => object(aState({ state, notifiedAt: T0, deadlineAt: new Date('2026-07-21T09:00:00Z') }), aVersion(), clockAt(T0)),
        'INVALID_STATE',
      );
    },
  );

  it('does not mutate the input state', () => {
    const input = notified('2026-07-21T09:00:00Z');
    object(input, aVersion(), clockAt('2026-07-10T00:00:00Z'));
    expect(input.state).toBe('NOTIFIED');
  });
});

describe('sweep', () => {
  const HARD = new Date('2026-07-21T09:00:00Z');
  const dueState = aState({ state: 'NOTIFIED', notifiedAt: T0, deadlineAt: HARD });

  describe('PASSIVE (tacit acceptance only from NOTIFIED)', () => {
    it('NOTIFIED + deadlineAt reached → ACCEPTED with outcome TACIT_ACCEPTED', () => {
      const result = sweep(dueState, aVersion(), clockAt('2026-07-22T00:00:00Z'));
      expect(result.outcome).toBe('TACIT_ACCEPTED');
      expect(result.state.state).toBe('ACCEPTED');
    });

    it('exactly at deadlineAt the period has been reached', () => {
      const result = sweep(dueState, aVersion(), clockAt('2026-07-21T09:00:00Z'));
      expect(result.outcome).toBe('TACIT_ACCEPTED');
    });

    it('before deadlineAt: no-op', () => {
      const result = sweep(dueState, aVersion(), clockAt('2026-07-20T09:00:00Z'));
      expect(result.outcome).toBe('NOOP');
      expect(result.state).toEqual(dueState);
    });

    it('PENDING_NOTIFICATION (never accessed, no deadline) is never swept → no-op (PASSIVE never tacit-books a non-accessor)', () => {
      const input = aState({ state: 'PENDING_NOTIFICATION', deadlineAt: undefined });
      expect(sweep(input, aVersion(), clockAt('2026-08-01T00:00:00Z')).outcome).toBe('NOOP');
    });

    it('NOTIFIED without deadlineAt (defensive): no-op — the period never runs without access', () => {
      const input = aState({ state: 'NOTIFIED', notifiedAt: T0, deadlineAt: undefined });
      expect(sweep(input, aVersion(), clockAt('2026-08-01T00:00:00Z')).outcome).toBe('NOOP');
    });

    it.each<CustomerVersionStateValue>(['ACCEPTED', 'OBJECTED', 'EXPIRED_BLOCKING', 'SUPERSEDED'])(
      'from %s: no-op',
      (state) => {
        const input = aState({ state, notifiedAt: T0, deadlineAt: HARD });
        expect(sweep(input, aVersion(), clockAt('2026-08-01T00:00:00Z')).outcome).toBe('NOOP');
      },
    );
  });

  describe('ACTIVE (absolute hard deadline → EXPIRED_BLOCKING, incl. never-accessed PENDING)', () => {
    const active = anActiveVersion({ hardDeadlineAt: HARD });

    it('NOTIFIED + hard deadline reached → EXPIRED_BLOCKING', () => {
      const result = sweep(dueState, active, clockAt('2026-07-22T00:00:00Z'));
      expect(result.outcome).toBe('EXPIRED_BLOCKING');
      expect(result.state.state).toBe('EXPIRED_BLOCKING');
      expect(isBlocking(result.state)).toBe(true);
    });

    it('PENDING_NOTIFICATION (never accessed) + hard deadline reached → EXPIRED_BLOCKING (notifiedAt stays undefined)', () => {
      const pending = aState({ state: 'PENDING_NOTIFICATION', notifiedAt: undefined, deadlineAt: HARD });
      const result = sweep(pending, active, clockAt('2026-07-22T00:00:00Z'));
      expect(result.outcome).toBe('EXPIRED_BLOCKING');
      expect(result.state.state).toBe('EXPIRED_BLOCKING');
      expect(result.state.notifiedAt).toBeUndefined();
    });

    it('exactly at the hard deadline the block applies', () => {
      const result = sweep(dueState, active, clockAt('2026-07-21T09:00:00Z'));
      expect(result.outcome).toBe('EXPIRED_BLOCKING');
    });

    it('before the hard deadline: no-op (compliant until the date)', () => {
      const result = sweep(dueState, active, clockAt('2026-07-20T09:00:00Z'));
      expect(result.outcome).toBe('NOOP');
    });

    it.each<CustomerVersionStateValue>(['ACCEPTED', 'OBJECTED', 'EXPIRED_BLOCKING', 'SUPERSEDED'])(
      'from %s: no-op (never re-blocks a decided/terminal state)',
      (state) => {
        const input = aState({ state, notifiedAt: T0, deadlineAt: HARD });
        expect(sweep(input, active, clockAt('2026-08-01T00:00:00Z')).outcome).toBe('NOOP');
      },
    );
  });

  it('SUPERSEDED is ignored — never TACIT for a superseded version', () => {
    const superseded = aState({ state: 'SUPERSEDED', notifiedAt: T0, deadlineAt: HARD });
    const result = sweep(superseded, aVersion(), clockAt('2026-08-01T00:00:00Z'));
    expect(result.outcome).toBe('NOOP');
    expect(result.state).toEqual(superseded);
  });
});

describe('supersede', () => {
  it.each<CustomerVersionStateValue>(['PENDING_NOTIFICATION', 'NOTIFIED', 'OBJECTED'])(
    'open state %s → SUPERSEDED, wasBlocking=false',
    (state) => {
      const result = supersede(aState({ state }));
      expect(result.state.state).toBe('SUPERSEDED');
      expect(result.wasBlocking).toBe(false);
    },
  );

  it('EXPIRED_BLOCKING → SUPERSEDED, reports wasBlocking=true (carry-over)', () => {
    const result = supersede(aState({ state: 'EXPIRED_BLOCKING' }));
    expect(result.state.state).toBe('SUPERSEDED');
    expect(result.wasBlocking).toBe(true);
  });

  it('from ACCEPTED → DomainError INVALID_STATE (evidence records are never superseded)', () => {
    expectDomainError(() => supersede(aState({ state: 'ACCEPTED' })), 'INVALID_STATE');
  });

  it('from SUPERSEDED: idempotent no-op with wasBlocking=false', () => {
    const input = aState({ state: 'SUPERSEDED' });
    const result = supersede(input);
    expect(result.state).toEqual(input);
    expect(result.wasBlocking).toBe(false);
  });

  it('does not mutate the input state', () => {
    const input = aState({ state: 'NOTIFIED' });
    supersede(input);
    expect(input.state).toBe('NOTIFIED');
  });
});

describe('isBlocking', () => {
  it('true for EXPIRED_BLOCKING', () => {
    expect(isBlocking(aState({ state: 'EXPIRED_BLOCKING' }))).toBe(true);
  });

  it.each<CustomerVersionStateValue>(['PENDING_NOTIFICATION', 'NOTIFIED', 'ACCEPTED', 'OBJECTED', 'SUPERSEDED'])(
    'false for %s (without carry-over)',
    (state) => {
      expect(isBlocking(aState({ state }))).toBe(false);
    },
  );

  // A document update does not lift existing blocks — the carry-over state blocks
  // IMMEDIATELY, not only after access plus an elapsed zero-length grace period.
  it.each<CustomerVersionStateValue>(['PENDING_NOTIFICATION', 'NOTIFIED'])(
    'true for %s with carryOverBlocking=true (the block remains until consent is given)',
    (state) => {
      expect(isBlocking(aState({ state, carryOverBlocking: true }))).toBe(true);
    },
  );

  it.each<CustomerVersionStateValue>(['ACCEPTED', 'OBJECTED', 'SUPERSEDED'])(
    'false for %s despite carryOverBlocking=true (consent/clarification lifts the block)',
    (state) => {
      expect(isBlocking(aState({ state, carryOverBlocking: true }))).toBe(false);
    },
  );
});

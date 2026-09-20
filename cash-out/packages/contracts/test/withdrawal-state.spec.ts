import {
  allowedTransitions,
  assertTransition,
  blocksNewWithdrawal,
  canTransition,
  DEBIT_OUTSTANDING_STATES,
  hasOutstandingDebit,
  IllegalWithdrawalTransitionError,
  isTerminal,
  isUncertain,
  isWithdrawalState,
  TERMINAL_STATES,
  toDriverStatus,
  toUserStatus,
  WITHDRAWAL_STATES,
  WithdrawalState,
} from '../src/withdrawal-state';

describe('the withdrawal state machine', () => {
  it('recognises exactly its own states', () => {
    for (const state of WITHDRAWAL_STATES) {
      expect(isWithdrawalState(state)).toBe(true);
    }
    expect(isWithdrawalState('APPROVED')).toBe(false);
    expect(isWithdrawalState(42)).toBe(false);
  });

  it('only ever transitions to a declared state', () => {
    for (const state of WITHDRAWAL_STATES) {
      for (const next of allowedTransitions(state)) {
        expect(isWithdrawalState(next)).toBe(true);
      }
    }
  });

  it('never lets a state transition to itself', () => {
    for (const state of WITHDRAWAL_STATES) {
      expect(canTransition(state, state)).toBe(false);
    }
  });

  it('throws loudly on an illegal transition', () => {
    expect(() => assertTransition('CREATED', 'COMPLETED')).toThrow(
      IllegalWithdrawalTransitionError,
    );
    expect(() => assertTransition('RESERVED', 'COMPLETED')).toThrow(
      IllegalWithdrawalTransitionError,
    );
    expect(() => assertTransition('CREATED', 'RISK_CHECK')).not.toThrow();
  });

  describe('the money-safety invariants', () => {
    it('reaches COMPLETED only from PAYOUT_CONFIRMED or an operator decision', () => {
      const sources = WITHDRAWAL_STATES.filter((s) => canTransition(s, 'COMPLETED'));
      expect(new Set(sources)).toEqual(new Set(['PAYOUT_CONFIRMED', 'MANUAL_REVIEW']));
    });

    it('never pays out before the Yandex debit is confirmed', () => {
      const sources = WITHDRAWAL_STATES.filter((s) => canTransition(s, 'PAYOUT_SUBMITTING'));
      expect(sources.length).toBeGreaterThan(0);
      for (const source of sources) {
        // Either the debit is already outstanding, or an operator decided.
        expect(DEBIT_OUTSTANDING_STATES.includes(source) || source === 'MANUAL_REVIEW').toBe(true);
      }
      expect(sources).toContain('RESERVED');
      expect(sources).not.toContain('CREATED');
      expect(sources).not.toContain('RISK_CHECK');
    });

    it('treats an uncertain external call as its own state, never as a failure', () => {
      expect(canTransition('RESERVING', 'RESERVE_UNCERTAIN')).toBe(true);
      expect(canTransition('PAYOUT_SUBMITTING', 'PAYOUT_UNCERTAIN')).toBe(true);
      expect(isUncertain('RESERVE_UNCERTAIN')).toBe(true);
      expect(isUncertain('PAYOUT_UNCERTAIN')).toBe(true);
      expect(isUncertain('RESERVED')).toBe(false);
    });

    it('never drops straight from an uncertain payout to a terminal success', () => {
      expect(canTransition('PAYOUT_UNCERTAIN', 'COMPLETED')).toBe(false);
      expect(canTransition('RESERVE_UNCERTAIN', 'COMPLETED')).toBe(false);
      expect(canTransition('RESERVE_PENDING', 'COMPLETED')).toBe(false);
    });

    it('treats an accepted-but-unfinished Yandex debit as its own state', () => {
      expect(canTransition('RESERVING', 'RESERVE_PENDING')).toBe(true);
      expect(canTransition('RESERVE_UNCERTAIN', 'RESERVE_PENDING')).toBe(true);
      expect(canTransition('RESERVE_PENDING', 'RESERVED')).toBe(true);
      // A final `fail` on a known transaction id is proof nothing was applied.
      expect(canTransition('RESERVE_PENDING', 'FAILED')).toBe(true);
      // ...but it never pays out before the debit is final.
      expect(canTransition('RESERVE_PENDING', 'PAYOUT_SUBMITTING')).toBe(false);
      expect(isUncertain('RESERVE_PENDING')).toBe(true);
    });

    it('reaches REVERSED only through COMPENSATING', () => {
      const sources = WITHDRAWAL_STATES.filter((s) => canTransition(s, 'REVERSED'));
      expect(new Set(sources)).toEqual(new Set(['COMPENSATING', 'MANUAL_REVIEW']));
    });

    it('never reaches FAILED from a state where the driver has already been debited', () => {
      for (const state of DEBIT_OUTSTANDING_STATES) {
        expect(canTransition(state, 'FAILED')).toBe(false);
      }
    });

    it('never reaches REJECTED after the debit either', () => {
      for (const state of DEBIT_OUTSTANDING_STATES) {
        expect(canTransition(state, 'REJECTED')).toBe(false);
      }
    });

    it('leaves every debited state a path to either COMPLETED or REVERSED', () => {
      for (const state of DEBIT_OUTSTANDING_STATES) {
        expect(reaches(state, 'COMPLETED') || reaches(state, 'REVERSED')).toBe(true);
      }
    });

    it('lets a settled payout still be returned by the provider', () => {
      expect(canTransition('COMPLETED', 'PAYOUT_RETURNED')).toBe(true);
      expect(canTransition('PAYOUT_CONFIRMED', 'PAYOUT_RETURNED')).toBe(true);
      expect(reaches('PAYOUT_RETURNED', 'REVERSED')).toBe(true);
    });
  });

  describe('terminal states', () => {
    it('are terminal, except that COMPLETED can still be returned', () => {
      for (const state of TERMINAL_STATES) {
        expect(isTerminal(state)).toBe(true);
        const outgoing = allowedTransitions(state);
        if (state === 'COMPLETED') {
          expect(outgoing).toEqual(['PAYOUT_RETURNED']);
        } else {
          expect(outgoing).toEqual([]);
        }
      }
    });

    it('stop blocking a new withdrawal', () => {
      for (const state of WITHDRAWAL_STATES) {
        expect(blocksNewWithdrawal(state)).toBe(!isTerminal(state));
      }
    });
  });

  describe('reachability', () => {
    it('reaches every state from CREATED', () => {
      for (const state of WITHDRAWAL_STATES) {
        if (state === 'CREATED') continue;
        expect(reaches('CREATED', state)).toBe(true);
      }
    });

    it('leaves no non-terminal state without an exit', () => {
      for (const state of WITHDRAWAL_STATES) {
        if (isTerminal(state)) continue;
        expect(allowedTransitions(state).length).toBeGreaterThan(0);
      }
    });

    it('lets every non-terminal state reach a terminal one', () => {
      for (const state of WITHDRAWAL_STATES) {
        if (isTerminal(state)) continue;
        const reachesTerminal = TERMINAL_STATES.some((terminal) => reaches(state, terminal));
        expect(reachesTerminal).toBe(true);
      }
    });
  });

  describe('the driver-facing projection', () => {
    it('maps every internal state', () => {
      for (const state of WITHDRAWAL_STATES) {
        expect(() => toDriverStatus(state)).not.toThrow();
      }
    });

    it('never tells a driver the money is sent while it is still uncertain', () => {
      for (const state of WITHDRAWAL_STATES) {
        if (toDriverStatus(state) === 'SENT') {
          expect(['PAYOUT_CONFIRMED', 'COMPLETED']).toContain(state);
        }
      }
    });

    it('shows a compensating withdrawal as still processing, not as failed', () => {
      expect(toDriverStatus('COMPENSATING')).toBe('PROCESSING');
    });

    it('flags states that need a human as UNDER_REVIEW', () => {
      expect(toDriverStatus('MANUAL_REVIEW')).toBe('UNDER_REVIEW');
      expect(toDriverStatus('RISK_REVIEW')).toBe('UNDER_REVIEW');
    });
  });

  it('classifies outstanding debits consistently', () => {
    for (const state of WITHDRAWAL_STATES) {
      expect(hasOutstandingDebit(state)).toBe(DEBIT_OUTSTANDING_STATES.includes(state));
    }
    expect(hasOutstandingDebit('CREATED')).toBe(false);
    expect(hasOutstandingDebit('RESERVED')).toBe(true);
  });
});

/** Breadth-first search over the transition graph. */
function reaches(from: WithdrawalState, to: WithdrawalState): boolean {
  const seen = new Set<WithdrawalState>([from]);
  const queue: WithdrawalState[] = [from];
  while (queue.length > 0) {
    const current = queue.shift() as WithdrawalState;
    for (const next of allowedTransitions(current)) {
      if (next === to) return true;
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return false;
}

describe('user statuses', () => {
  it('maps every internal state to one of the four words', () => {
    for (const state of WITHDRAWAL_STATES) {
      expect(['COMPLETED', 'PROCESSING', 'CANCELLED', 'REJECTED']).toContain(toUserStatus(state));
    }
  });

  it('calls money that reached the driver COMPLETED and money that never left REJECTED', () => {
    expect(toUserStatus('COMPLETED')).toBe('COMPLETED');
    expect(toUserStatus('PAYOUT_CONFIRMED')).toBe('COMPLETED');
    expect(toUserStatus('REJECTED')).toBe('REJECTED');
    expect(toUserStatus('FAILED')).toBe('REJECTED');
  });

  it('calls a debit that is being or has been put back CANCELLED', () => {
    for (const state of ['PAYOUT_FAILED', 'PAYOUT_RETURNED', 'COMPENSATING', 'REVERSED'] as const) {
      expect(toUserStatus(state)).toBe('CANCELLED');
    }
  });

  it('calls everything in flight, including human review, PROCESSING', () => {
    for (const state of [
      'CREATED',
      'RESERVING',
      'RESERVE_PENDING',
      'PAYOUT_SUBMITTED',
      'MANUAL_REVIEW',
    ] as const) {
      expect(toUserStatus(state)).toBe('PROCESSING');
    }
  });
});

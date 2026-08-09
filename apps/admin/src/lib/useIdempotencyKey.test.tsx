import { renderHook } from '@testing-library/react';
import { useIdempotencyKey } from './useIdempotencyKey';

/**
 * The property that matters is not what a key looks like — it is when it
 * stays the same.
 *
 * A key that changes on every render, or on every attempt, cannot be matched
 * by the server, and every crash-window protection the money paths grew in
 * `AUDIT_FINANCIAL_2026-08.md` depends on the server seeing the same key
 * twice. A key that never changes is the opposite failure: the second, real
 * refund would come back as a replay of the first.
 */
describe('useIdempotencyKey', () => {
  it('holds one key across re-renders of the same operation', () => {
    const { result, rerender } = renderHook(({ id }) => useIdempotencyKey([id]), {
      initialProps: { id: 'payment-1' },
    });

    const first = result.current;
    rerender({ id: 'payment-1' });
    rerender({ id: 'payment-1' });

    expect(result.current).toBe(first);
  });

  it('survives a retry: the same inputs after a failure send the same key', () => {
    // The failure this exists for. `httpClient` gives up at fifteen seconds;
    // a refund that commits at sixteen returns "timeout of 15000ms exceeded"
    // to an operator who cannot tell that from a refusal. They press the
    // button again — and the request has to carry the key the first attempt
    // used, or the customer is paid twice.
    const { result, rerender } = renderHook(({ amount }) => useIdempotencyKey(['payment-1', amount]), {
      initialProps: { amount: '500.00' },
    });

    const attemptOne = result.current;
    rerender({ amount: '500.00' }); // the operator pressed Refund again
    const attemptTwo = result.current;

    expect(attemptTwo).toBe(attemptOne);
  });

  it('mints a new key when the amount changes', () => {
    // Reusing a key across a changed amount is the mirror-image defect: the
    // server would answer a 200 refund with the result of the 500 one, and
    // the operator would be told money moved that never did.
    const { result, rerender } = renderHook(({ amount }) => useIdempotencyKey(['payment-1', amount]), {
      initialProps: { amount: '500.00' },
    });

    const forFiveHundred = result.current;
    rerender({ amount: '200.00' });

    expect(result.current).not.toBe(forFiveHundred);
  });

  it('mints a new key when the operation moves to a different payment', () => {
    const { result, rerender } = renderHook(({ id }) => useIdempotencyKey([id, '100.00']), {
      initialProps: { id: 'payment-1' },
    });

    const forFirst = result.current;
    rerender({ id: 'payment-2' });

    expect(result.current).not.toBe(forFirst);
  });

  it('gives two operations started at the same moment different keys', () => {
    // `Date.now()` alone collides when two things happen inside one
    // millisecond, which under a script or a fast operator is not rare.
    const a = renderHook(() => useIdempotencyKey(['payment-1', '10.00']));
    const b = renderHook(() => useIdempotencyKey(['payment-1', '10.00']));

    expect(a.result.current).not.toBe(b.result.current);
  });
});

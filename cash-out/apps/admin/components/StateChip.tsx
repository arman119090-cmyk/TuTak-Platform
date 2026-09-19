/**
 * The internal withdrawal state, coloured by what it means operationally
 * rather than by where it sits in the alphabet: red is "money is out and has
 * not arrived", amber is "a person must look at this", green is done.
 */
const TONE: Record<string, 'ok' | 'warn' | 'danger' | 'info' | 'neutral'> = {
  CREATED: 'neutral',
  RISK_CHECK: 'neutral',
  RISK_REVIEW: 'warn',
  REJECTED: 'neutral',
  RESERVING: 'info',
  RESERVE_UNCERTAIN: 'danger',
  RESERVED: 'info',
  PAYOUT_SUBMITTING: 'info',
  PAYOUT_UNCERTAIN: 'danger',
  PAYOUT_SUBMITTED: 'info',
  PAYOUT_CONFIRMED: 'ok',
  COMPLETED: 'ok',
  PAYOUT_FAILED: 'danger',
  PAYOUT_RETURNED: 'danger',
  COMPENSATING: 'warn',
  REVERSED: 'neutral',
  FAILED: 'neutral',
  MANUAL_REVIEW: 'warn',
};

export function StateChip({ state }: { state: string }) {
  return <span className={`chip ${TONE[state] ?? 'neutral'}`}>{state.replace(/_/g, ' ')}</span>;
}

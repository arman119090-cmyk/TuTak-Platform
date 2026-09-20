import type { WithdrawalDto } from '@cashout/contracts';

export type FailureVariant = 'review' | 'cancelled' | 'rejected' | 'failed';

/**
 * Which failure the driver is looking at. The history vocabulary decides the
 * words: a cancelled payout kept the money, a rejected one was refused by the
 * rail or the park, a review means a person is looking.
 */
export function failureVariant(
  withdrawal: Pick<WithdrawalDto, 'status' | 'userStatus'> | null | undefined,
): FailureVariant {
  if (!withdrawal) return 'failed';
  if (withdrawal.status === 'UNDER_REVIEW') return 'review';
  if (withdrawal.userStatus === 'CANCELLED') return 'cancelled';
  if (withdrawal.userStatus === 'REJECTED') return 'rejected';
  return 'failed';
}

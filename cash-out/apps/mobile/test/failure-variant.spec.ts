import { failureVariant } from '../src/withdraw/failure-variant';

describe('what the failure screen says', () => {
  it('a payout under review is a review, whatever the user status says', () => {
    expect(failureVariant({ status: 'UNDER_REVIEW', userStatus: 'PROCESSING' })).toBe('review');
  });

  it('cancelled keeps the money; rejected was refused', () => {
    expect(failureVariant({ status: 'FAILED', userStatus: 'CANCELLED' })).toBe('cancelled');
    expect(failureVariant({ status: 'FAILED', userStatus: 'REJECTED' })).toBe('rejected');
  });

  it('with nothing loaded yet, the generic failure', () => {
    expect(failureVariant(null)).toBe('failed');
    expect(failureVariant({ status: 'FAILED', userStatus: 'PROCESSING' })).toBe('failed');
  });
});

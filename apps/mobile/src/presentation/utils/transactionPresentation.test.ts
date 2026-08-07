import {
  bonusStateFor,
  evStatusTone,
  transactionIcon,
  transactionTone,
} from './transactionPresentation';

describe('transactionTone', () => {
  it('marks bonus accrual and referral reward as positive', () => {
    expect(transactionTone('BONUS_ACCRUAL')).toBe('positive');
    expect(transactionTone('REFERRAL_REWARD')).toBe('positive');
  });

  it('treats every other transaction type as neutral', () => {
    expect(transactionTone('QR_PAYMENT')).toBe('default');
    expect(transactionTone('EV_CHARGING')).toBe('default');
    expect(transactionTone('BONUS_REDEMPTION')).toBe('default');
    expect(transactionTone('REFUND')).toBe('default');
    expect(transactionTone('MANUAL_ADJUSTMENT')).toBe('default');
  });
});

describe('transactionIcon', () => {
  it('maps every known transaction type to a distinct icon', () => {
    const types = [
      'QR_PAYMENT',
      'EV_CHARGING',
      'BONUS_ACCRUAL',
      'BONUS_REDEMPTION',
      'REFERRAL_REWARD',
      'REFUND',
      'MANUAL_ADJUSTMENT',
    ];
    const icons = types.map(transactionIcon);
    expect(new Set(icons).size).toBe(types.length);
  });

  it('falls back to a neutral icon for an unrecognized type', () => {
    expect(transactionIcon('SOMETHING_NEW')).toBe('ellipse-outline');
  });
});

describe('bonusStateFor', () => {
  it('maps PENDING and RESERVED to their own states', () => {
    expect(bonusStateFor('PENDING')).toBe('pending');
    expect(bonusStateFor('RESERVED')).toBe('reserved');
  });

  it('treats every other status as available', () => {
    expect(bonusStateFor('AVAILABLE')).toBe('available');
    expect(bonusStateFor('SETTLED')).toBe('available');
    expect(bonusStateFor('EXPIRED')).toBe('available');
  });
});

describe('evStatusTone', () => {
  it('maps AVAILABLE to available', () => {
    expect(evStatusTone('AVAILABLE')).toBe('available');
  });

  it('maps CHARGING and RESERVED to reserved', () => {
    expect(evStatusTone('CHARGING')).toBe('reserved');
    expect(evStatusTone('RESERVED')).toBe('reserved');
  });

  it('treats every other status as pending', () => {
    expect(evStatusTone('COMPLETED')).toBe('pending');
    expect(evStatusTone('CANCELLED')).toBe('pending');
  });
});

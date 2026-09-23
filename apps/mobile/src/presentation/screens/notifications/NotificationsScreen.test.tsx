import { readableParams } from './NotificationsScreen';

jest.mock('../../../data/api/notificationsApi', () => ({ notificationsApi: {} }));

describe('readableParams', () => {
  const t = (key: string, options?: Record<string, unknown>) =>
    key === 'transactionType.QR_PAYMENT' ? 'QR payment' : String(options?.defaultValue ?? key);

  it('names the operation and formats the amount instead of printing the raw record', () => {
    const out = readableParams({ type: 'QR_PAYMENT', amount: '1500.0000' }, t);
    expect(out.type).toBe('QR payment');
    expect(out.amount).not.toContain('1500.0000');
    expect(String(out.amount)).toContain('֏');
  });

  it('keeps an unknown type readable rather than blank', () => {
    expect(readableParams({ type: 'SOMETHING_NEW' }, t).type).toBe('SOMETHING_NEW');
  });

  it('leaves a notification without parameters alone', () => {
    expect(readableParams(null, t)).toEqual({});
  });
});

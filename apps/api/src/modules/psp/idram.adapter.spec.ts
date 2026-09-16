import { idramPaymentChecksum } from './idram.adapter';

describe('Idram checksum contract', () => {
  it('matches the documented Idram field order with SECRET_KEY as the third value', () => {
    const checksum = idramPaymentChecksum(
      {
        recAccount: '111222333',
        amount: '14000.00',
        billNo: 'contract-bill-1',
        payerAccount: '55566677',
        transId: '12345678901234',
        transDate: '15/09/2026',
      },
      'test-idram-secret',
    );

    // Hard-coded independent vector for:
    // REC_ACCOUNT:AMOUNT:SECRET_KEY:BILL_NO:PAYER_ACCOUNT:TRANS_ID:TRANS_DATE
    expect(checksum).toBe('F81256BF3FE2704A8790DD669316FF27');
  });
});

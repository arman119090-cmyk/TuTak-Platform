import { AxiosError, AxiosHeaders } from 'axios';
import { isWalletAbsent } from './walletApi';

/**
 * The distinction this helper exists to draw.
 *
 * An administrator signing in to the customer app saw "Something went wrong"
 * on both the home screen and the wallet screen. Nothing had gone wrong: the
 * account simply has no wallet — `seed-baseline` creates the bootstrap
 * administrator without one, deliberately — and all three wallet reads
 * answer 404 (pinned in `apps/api/test/wallet-without-wallet.int-spec.ts`).
 *
 * The risk in fixing that is over-reaching. `WalletScreen` and `HomeScreen`
 * refuse to draw a balance they did not receive, on purpose: a confident
 * "0 points" is the one number a customer will believe and act on. So this
 * must recognise 404 and nothing else — every other failure has to keep
 * going down the path that shows an error instead of a number.
 */
describe('isWalletAbsent', () => {
  const withStatus = (status: number) =>
    new AxiosError('failed', undefined, undefined, undefined, {
      status,
      statusText: '',
      data: {},
      headers: {},
      config: { headers: new AxiosHeaders() },
    });

  it('recognises the server saying this account has no wallet', () => {
    expect(isWalletAbsent(withStatus(404))).toBe(true);
  });

  it.each([400, 401, 403, 409, 429, 500, 502, 503])(
    'does not treat %i as an absent wallet',
    (status) => {
      expect(isWalletAbsent(withStatus(status))).toBe(false);
    },
  );

  it('does not treat a request that never got an answer as an absent wallet', () => {
    // A phone in a lift: no response at all. The balance did not arrive, and
    // the screen must say so rather than claim the account has no wallet.
    expect(isWalletAbsent(new AxiosError('Network Error', 'ECONNABORTED'))).toBe(false);
  });

  it('ignores values that are not axios errors', () => {
    expect(isWalletAbsent(new Error('boom'))).toBe(false);
    expect(isWalletAbsent(undefined)).toBe(false);
    expect(isWalletAbsent(null)).toBe(false);
    expect(isWalletAbsent({ response: { status: 404 } })).toBe(false);
  });
});

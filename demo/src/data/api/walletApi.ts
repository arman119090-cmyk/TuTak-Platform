import type {
  BonusLedgerEntryDto,
  BonusLotDto,
  PaginatedResultDto,
  WalletBalanceDto,
} from '@tutak/shared-types';
import axios from 'axios';
import { httpClient, ApiEnvelope } from './httpClient';

/**
 * Whether the server answered that this account has no wallet at all.
 *
 * Not the same thing as a wallet request that failed, and the difference is
 * the whole point. Every account the app itself registers gets a wallet in
 * the same statement that creates the user, so the two are inseparable for
 * anyone who signs up. Accounts created another way — the bootstrap
 * administrator a deployment is seeded with — have none, and all three
 * wallet reads answer 404 for them.
 *
 * A 404 here is an answer, not a failure: the server reached the database,
 * looked, and reported that there is nothing to look at. Showing "something
 * went wrong" for it tells a person their app is broken when it is working
 * exactly as built, which is what an administrator signing in to the
 * customer app on a handset actually saw.
 *
 * Deliberately narrow — 404 and nothing else. A timeout, a 500, a phone in a
 * lift all still mean the balance did not arrive, and `WalletScreen` and
 * `HomeScreen` must go on refusing to draw a number they never received.
 */
export function isWalletAbsent(error: unknown): boolean {
  return axios.isAxiosError(error) && error.response?.status === 404;
}

export const walletApi = {
  async getMyWallet() {
    const { data } = await httpClient.get<ApiEnvelope<WalletBalanceDto>>('/wallet/me');
    return data.data;
  },

  async getMyLedger(cursor?: string) {
    const { data } = await httpClient.get<ApiEnvelope<PaginatedResultDto<BonusLedgerEntryDto>>>(
      '/wallet/me/ledger',
      { params: { cursor } },
    );
    return data.data;
  },

  async getMyLots() {
    const { data } = await httpClient.get<ApiEnvelope<BonusLotDto[]>>('/wallet/me/lots');
    return data.data;
  },
};

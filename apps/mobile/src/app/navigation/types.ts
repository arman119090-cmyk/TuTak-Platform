import type { EvSessionDto, PurchaseIntentDto } from '@tutak/shared-types';

export type AuthStackParamList = {
  Login: undefined;
  Register: undefined;
  ForgotPassword: undefined;
  ResetPassword: { phone: string };
};

export type MainTabParamList = {
  Home: undefined;
  Wallet: undefined;
  Pay: undefined;
  /**
   * Stations and partners share one map (see `PartnersScreen`). `filter`
   * lets a caller land directly on the stations view — the home screen's
   * "Начать зарядку" quick action passes `'stations'` rather than pushing a
   * separate route, since there no longer is one.
   */
  Partners: { filter?: 'stations' } | undefined;
  Settings: undefined;
};

export type RootStackParamList = {
  Main: undefined;
  ScanQr: undefined;
  Notifications: undefined;
  TransactionHistory: undefined;
  Referral: undefined;
  EvHistory: undefined;
  /** The session is passed through so the screen renders instantly on start;
      it re-polls for the authoritative figures either way. */
  EvSession: { session?: EvSessionDto } | undefined;
  ChangePassword: undefined;
  VerifyPhone: undefined;
  DeleteAccount: undefined;
  /** Spec §7: the customer has picked a partner (a map card's "Pay" action)
      and now enters the gross amount and, optionally, how much bonus to
      apply — the intent itself does not exist yet. */
  CreatePurchaseIntent: { partnerId: string; partnerBranchId?: string; partnerName?: string };
  /** The intent already exists; this screen only tracks it to a terminal
      state. Passed through so the screen renders instantly, the same way
      `EvSession` receives its session — it re-polls for the authoritative
      status either way. */
  PurchaseIntentStatus: { intent: PurchaseIntentDto };
};

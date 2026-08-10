import type { EvSessionDto } from '@tutak/shared-types';

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
  Partners: undefined;
  Settings: undefined;
};

export type RootStackParamList = {
  Main: undefined;
  ScanQr: undefined;
  Notifications: undefined;
  TransactionHistory: undefined;
  Referral: undefined;
  /**
   * Charging moved out of the tab bar to make room for the map.
   *
   * Six tabs do not fit a Russian or Armenian label without truncating, and
   * of the six this is the narrowest audience — it matters to drivers, where
   * the partner map matters to everybody. It keeps its tile on the home
   * screen, which is how most people reached it anyway.
   */
  EvStations: undefined;
  EvHistory: undefined;
  /** The session is passed through so the screen renders instantly on start;
      it re-polls for the authoritative figures either way. */
  EvSession: { session?: EvSessionDto } | undefined;
  ChangePassword: undefined;
  VerifyPhone: undefined;
  DeleteAccount: undefined;
};

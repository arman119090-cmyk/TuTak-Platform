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
  EvCharging: undefined;
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
};

export interface AppConfig {
  nodeEnv: string;
  port: number;
  database: { url: string };
  redis: { url: string };
  jwt: {
    accessSecret: string;
    accessExpiresIn: string;
    refreshSecret: string;
    refreshExpiresIn: string;
  };
  bonus: {
    pendingHours: number;
    expiryMonths: number;
    reservationHoldSeconds: number;
    referralRewardAmount: string;
  };
  rateLimit: { ttlSeconds: number; maxRequests: number };
  cors: { origins: string[] };
  ocpi: {
    partyId: string;
    countryCode: string;
    token: string;
    baseUrl: string;
  };
  sms: {
    endpoint: string;
    authScheme: 'basic' | 'bearer';
    username: string;
    token: string;
    sender: string;
    encoding: 'form' | 'json';
  };
  features: {
    /**
     * Phase 4 of docs/FINANCIAL_CORE_DESIGN.md: mirror QR redemptions into
     * the double-entry ledger alongside the existing path.
     *
     * Off by default and additive when on — the old path stays authoritative
     * for what the customer is told, and the mirror only writes ledger
     * postings. §9 marks this cut-over as the high-risk one and calls for a
     * dual-write period with reconciliation before the old path is removed;
     * this flag is what makes that period possible.
     */
    qrLedgerMirror: boolean;
  };
}

export default (): AppConfig => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '4000', 10),
  database: {
    url: process.env.DATABASE_URL ?? '',
  },
  redis: {
    url: process.env.REDIS_URL ?? 'redis://localhost:6379',
  },
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET ?? '',
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? '15m',
    refreshSecret: process.env.JWT_REFRESH_SECRET ?? '',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '30d',
  },
  bonus: {
    pendingHours: parseInt(process.env.BONUS_PENDING_HOURS ?? '48', 10),
    expiryMonths: parseInt(process.env.BONUS_EXPIRY_MONTHS ?? '12', 10),
    reservationHoldSeconds: parseInt(
      process.env.BONUS_RESERVATION_HOLD_SECONDS ?? '300',
      10,
    ),
    referralRewardAmount: process.env.REFERRAL_REWARD_AMOUNT ?? '1000',
  },
  rateLimit: {
    ttlSeconds: parseInt(process.env.RATE_LIMIT_TTL_SECONDS ?? '60', 10),
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS ?? '120', 10),
  },
  cors: {
    origins: (process.env.CORS_ORIGINS ?? '').split(',').filter(Boolean),
  },
  ocpi: {
    partyId: process.env.OCPI_PARTY_ID ?? 'TTK',
    countryCode: process.env.OCPI_COUNTRY_CODE ?? 'AM',
    token: process.env.OCPI_TOKEN ?? '',
    baseUrl: process.env.OCPI_BASE_URL ?? '',
  },
  sms: {
    endpoint: process.env.SMS_ENDPOINT ?? '',
    authScheme: (process.env.SMS_AUTH_SCHEME as 'basic' | 'bearer') ?? 'basic',
    username: process.env.SMS_USERNAME ?? '',
    token: process.env.SMS_TOKEN ?? '',
    sender: process.env.SMS_SENDER ?? 'TuTak',
    encoding: (process.env.SMS_ENCODING as 'form' | 'json') ?? 'form',
  },
  features: {
    // Opt-in, and it must stay that way until a full settlement cycle has
    // reconciled clean.
    qrLedgerMirror: process.env.FEATURE_QR_LEDGER_MIRROR === 'true',
  },
});

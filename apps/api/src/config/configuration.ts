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
});

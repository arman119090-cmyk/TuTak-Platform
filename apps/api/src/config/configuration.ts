export interface AppConfig {
  nodeEnv: string;
  /**
   * A public demonstration, running every production protection, on a fake
   * acquirer.
   *
   * There are two deployments this platform already knows how to be: a
   * developer's machine, where anything goes, and production, where the
   * process refuses to start unless a real acquirer and a real SMS carrier
   * are configured. Showing the product to somebody is neither. It has to be
   * reachable from the open internet — so it needs the CORS allowlist, the
   * security headers, the rate limits and the secret validation that only
   * production turns on — while having no acquirer contract and no carrier,
   * which is exactly what production refuses to boot without.
   *
   * Demo mode is that third state, and it is deliberately awkward to enter:
   * it is an explicit environment variable that nothing else implies, it is
   * announced in a banner at boot, and it is reported by `/health` so a
   * dashboard can label itself. Nothing here relaxes a security control. The
   * only thing it permits is the fake acquirer and the console SMS provider,
   * which is the difference between a demonstration and a lie about one.
   *
   * **No real money can move in this mode, and nobody should be told
   * otherwise.**
   */
  demoMode: boolean;
  port: number;
  database: { url: string };
  redis: { url: string };
  queue: { prefix: string };
  sweeps: { enabled: boolean };
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
    /** Ceiling on a single admin credit or debit. Points are a liability. */
    manualAdjustmentMax: string;
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
  push: {
    enabled: boolean;
    endpoint: string;
    accessToken: string;
  };
  tracing: {
    endpoint: string;
    headers: string;
    serviceName: string;
    debug: boolean;
  };
  alerts: {
    /** Where an operator gets told that money is at risk. Empty = the log only. */
    webhookUrl: string;
  };
  payouts: {
    /** Whether confirming a payout requires someone other than its requester. */
    dualControl: boolean;
  };
  metrics: {
    /** Bearer token a Prometheus scraper must present. Empty disables /metrics. */
    token: string;
  };
  accountDeletion: {
    /**
     * Days between a customer deleting their account and their personal data
     * being scrubbed. Access ends immediately either way.
     */
    graceDays: number;
  };
  /**
   * How long non-financial records are kept. Nothing financial appears here
   * — see `RetentionService` for what is deliberately excluded and why.
   */
  retention: {
    notificationDays: number;
    sessionDays: number;
    challengeDays: number;
    qrCodeDays: number;
    idempotencyDays: number;
    outboxDays: number;
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
  // Compared against the exact string, so an unset variable, an empty one,
  // `1`, or `yes` all leave it off. Something this consequential should
  // require someone to have typed the word.
  demoMode: process.env.DEMO_MODE === 'true',
  port: parseInt(process.env.PORT ?? '4000', 10),
  database: {
    url: process.env.DATABASE_URL ?? '',
  },
  redis: {
    url: process.env.REDIS_URL ?? 'redis://localhost:6379',
  },
  queue: {
    // Keyspace for BullMQ. Set it per environment when several share a Redis,
    // or staging will drain production's jobs.
    prefix: process.env.QUEUE_PREFIX ?? 'tutak',
  },
  sweeps: {
    // On unless explicitly disabled. A deployment with this off runs no
    // recurring work at all: no settlement, no bonus promotion, no expiry.
    enabled: (process.env.SWEEPS_ENABLED ?? 'true') !== 'false',
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
    // A goodwill credit is normally a few thousand points. A million is
    // already far beyond any plausible correction, which makes it a useful
    // place to stop: large enough never to obstruct real work, small enough
    // that a fat-fingered extra three zeros is refused rather than becoming
    // a liability nobody notices until the balance sheet.
    manualAdjustmentMax: process.env.BONUS_MANUAL_ADJUSTMENT_MAX ?? '1000000',
  },
  accountDeletion: {
    // Thirty days, chosen against this platform rather than as a round
    // number. Two things have to be able to happen after someone deletes
    // their account, and both are bounded by roughly a month: a card
    // chargeback or a partner-initiated refund can still arrive against a
    // payment made days earlier and has to post against a wallet that still
    // exists; and a customer who deleted by mistake has to have a window in
    // which support can restore them. Scrubbing immediately would make the
    // first impossible to settle and the second impossible to honour, and
    // waiting a year would keep phone numbers we have no reason to hold.
    //
    // Access ends the moment they press the button — this window is about
    // the data, not the account.
    graceDays: parseInt(process.env.ACCOUNT_DELETION_GRACE_DAYS ?? '30', 10),
  },
  retention: {
    // Ninety days of read notifications is enough for a customer to scroll
    // back through a season of activity; unread ones are never pruned.
    notificationDays: parseInt(process.env.RETENTION_NOTIFICATION_DAYS ?? '90', 10),
    // Refresh tokens carry the IP and user agent of every sign-in, which is
    // the most sensitive thing this sweep touches. Ninety days keeps a
    // meaningful "where has this account been used from" history for an abuse
    // investigation without keeping it indefinitely.
    sessionDays: parseInt(process.env.RETENTION_SESSION_DAYS ?? '90', 10),
    // A reset or verification code is dead the moment it expires. Thirty days
    // exists only so somebody investigating an account takeover the week
    // after can still see the attempts.
    challengeDays: parseInt(process.env.RETENTION_CHALLENGE_DAYS ?? '30', 10),
    // A spent QR code is not the record of the purchase — the transaction is.
    qrCodeDays: parseInt(process.env.RETENTION_QR_CODE_DAYS ?? '90', 10),
    // The longest of the short periods on purpose. An idempotency key deleted
    // while a client might still retry turns that retry into a second
    // payment, so this errs far past any plausible retry horizon.
    idempotencyDays: parseInt(process.env.RETENTION_IDEMPOTENCY_DAYS ?? '180', 10),
    // Only processed rows are ever pruned; an unprocessed one is settlement
    // that has not happened yet.
    outboxDays: parseInt(process.env.RETENTION_OUTBOX_DAYS ?? '90', 10),
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
  push: {
    // Off by default so local development needs no Expo project. Production
    // refuses to boot without it — see PushModule.
    enabled: process.env.PUSH_ENABLED === 'true',
    endpoint: process.env.PUSH_ENDPOINT ?? 'https://exp.host/--/api/v2/push/send',
    accessToken: process.env.PUSH_ACCESS_TOKEN ?? '',
  },
  alerts: {
    // A Slack/Mattermost/Discord incoming webhook, or anything that accepts a
    // JSON POST. Unset in development; production boots without it but warns
    // — see AlertsModule for why it does not refuse.
    webhookUrl: process.env.ALERT_WEBHOOK_URL ?? '',
  },
  metrics: {
    // No default. An unset token disables the endpoint rather than opening
    // it — these numbers are the operating figures of the business.
    token: process.env.METRICS_TOKEN ?? '',
  },
  payouts: {
    // On unless explicitly disabled. The safe default for a control that
    // exists to stop one compromised account from moving money out on its
    // own; an operation genuinely run by one person turns it off knowingly,
    // which is a decision someone made rather than one nobody noticed.
    dualControl: process.env.PAYOUT_DUAL_CONTROL !== 'false',
  },
  tracing: {
    // Standard OpenTelemetry variable names, so a collector's own
    // documentation applies without translation.
    endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? '',
    headers: process.env.OTEL_EXPORTER_OTLP_HEADERS ?? '',
    serviceName: process.env.OTEL_SERVICE_NAME ?? 'tutak-api',
    debug: process.env.OTEL_DEBUG === 'true',
  },
  features: {
    // Opt-in, and it must stay that way until a full settlement cycle has
    // reconciled clean.
    qrLedgerMirror: process.env.FEATURE_QR_LEDGER_MIRROR === 'true',
  },
});

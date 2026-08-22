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
  /**
   * Raw value of `TRUST_PROXY`, handed to Express's `app.set('trust proxy', …)`
   * verbatim when non-empty — a specific IP/CIDR, a comma-separated list of
   * them, or one of Express's named subnets (`loopback`, `linklocal`,
   * `uniquelocal`), matching this deployment's actual reverse proxy. Empty
   * means untrusted (`main.ts` leaves Express's own default, `false`, in
   * effect): `req.ip` is then the real TCP peer address, which a client
   * cannot spoof via `X-Forwarded-For`. See `main.ts` for why a bare hop
   * count (`1`) is deliberately not accepted here.
   */
  trustProxy: string;
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
    /**
     * The legacy card-payment/PSP subsystem (`PaymentsModule`: `/payments`,
     * `/refunds`, `PaymentEngineService`, `RefundEngineService`).
     *
     * The approved canonical model does not have TuTak charge the
     * customer's card at all — the customer pays the partner directly
     * outside TuTak, and the whole PurchaseIntent/refund path this platform
     * actually ships on (`purchase-intents`) never touches a PSP. Yet
     * `PaymentsModule` used to be imported unconditionally, and its own
     * provider factory refuses to boot `NODE_ENV=production` without either
     * a real acquirer or `DEMO_MODE=true` — meaning a canonical production
     * deployment, which needs neither, could not start at all without lying
     * about having an acquirer it does not have.
     *
     * Off by default: canonical production boots with no PSP configured and
     * `/payments`/`/refunds` simply do not exist as routes (independent
     * audit, GitHub issue #28). Set this explicitly to keep running the
     * legacy card-payment surface — local dev, the demo stack, and this
     * repo's own integration-test harness all set it explicitly rather than
     * relying on the default, so nothing here silently changes what they
     * already exercise. In production, turning this on still goes through
     * `PaymentsModule`'s own guard: no real PSP configured (and no
     * `DEMO_MODE`) still refuses to boot, exactly as before.
     */
    cardPaymentsEnabled: boolean;
  };
  /**
   * Every number the new core-business spec fixes, in one place, per its own
   * §37 ("Centralized business configuration") and §12/§13/§18. Read by
   * `PurchaseIntentService`, `DeferredBonusLotService` and `ReferralService`
   * — nowhere else should hardcode one of these values.
   *
   * See docs/CORE_ARCHITECTURE_MIGRATION_2026-08.md for why these replace
   * (rather than extend) the old `REFERRAL_COMMISSION_MODEL_RU.md` figures.
   */
  purchasePolicy: {
    /** Spec §7. How long a PurchaseIntent waits for staff confirmation. */
    intentTimeoutSeconds: number;
    /**
     * 2026-08-22 3-level referral rework. Fractions of `grossAmount ×
     * negotiatedRateBps` (the contribution pool) that go to, respectively:
     * the customer's immediate green bonus, the customer's deferred/locked
     * bonus, the Level-1/2/3 referrer (their whole chain, up to 3 people —
     * a level with no recipient folds into TuTak's own leg instead of being
     * left unpaid or redistributed), and TuTak itself. Basis points so all
     * six are exact integers that sum to 10 000 —
     * `assertPoolSplitSums` asserts this at boot rather than trusting the
     * deployment config. Replaces the old single-leg `poolReferrerBps`
     * (20/30/20/30) outright; do not resurrect it or reuse its old value
     * for `poolReferrerL1Bps` — see docs/NEXT_CLAUDE_TASK.md and
     * `docs/HARDENING_AUDIT_2026-08-16.md` for the full worked example.
     */
    poolGreenBps: number;
    poolDeferredBps: number;
    poolReferrerL1Bps: number;
    poolReferrerL2Bps: number;
    poolReferrerL3Bps: number;
    poolTutakBps: number;
    /** Spec §13. Deferred lot unlock window, in months. */
    deferredWindowMonths: number;
    /** Spec §13. Cumulative gross turnover required to unlock a deferred lot. */
    deferredRequiredTurnover: string;
    /** Spec §18. Cumulative gross turnover to qualify a Referral Challenge participant. */
    challengeQualificationAmount: string;
    /** Spec §18. Paid to the inviter AND, separately, to the qualifying referee. */
    challengeRewardAmount: string;
    /** Spec §18. "First 3 qualified friends" — this is the 3. */
    challengeSlotLimit: number;
  };
}

/**
 * Refuses to boot on a pool split that cannot represent 100% of the
 * contribution pool — the same "fail loudly at startup, not silently at
 * settlement time" discipline this file already applies to CORS and the SMS
 * provider. A typo in one env var here would otherwise mint or destroy value
 * on every single purchase and nobody would notice until reconciliation.
 */
export function assertPoolSplitSums(policy: AppConfig['purchasePolicy']): void {
  const legs = [
    policy.poolGreenBps,
    policy.poolDeferredBps,
    policy.poolReferrerL1Bps,
    policy.poolReferrerL2Bps,
    policy.poolReferrerL3Bps,
    policy.poolTutakBps,
  ];
  if (legs.some((bps) => !Number.isInteger(bps) || bps < 0 || bps > 10_000)) {
    throw new Error(
      `purchasePolicy pool split legs must each be an integer between 0 and 10000, got ` +
        `green ${policy.poolGreenBps}, deferred ${policy.poolDeferredBps}, L1 ${policy.poolReferrerL1Bps}, ` +
        `L2 ${policy.poolReferrerL2Bps}, L3 ${policy.poolReferrerL3Bps}, tutak ${policy.poolTutakBps}`,
    );
  }
  const total = legs.reduce((sum, bps) => sum + bps, 0);
  if (total !== 10_000) {
    throw new Error(
      `purchasePolicy pool split must sum to 10000 basis points, got ${total} ` +
        `(green ${policy.poolGreenBps} + deferred ${policy.poolDeferredBps} + ` +
        `L1 ${policy.poolReferrerL1Bps} + L2 ${policy.poolReferrerL2Bps} + L3 ${policy.poolReferrerL3Bps} + ` +
        `tutak ${policy.poolTutakBps})`,
    );
  }
}

export default (): AppConfig => {
  const config = buildConfig();
  assertPoolSplitSums(config.purchasePolicy);
  return config;
};

const buildConfig = (): AppConfig => ({
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
  trustProxy: (process.env.TRUST_PROXY ?? '').trim(),
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
    // Off unless explicitly turned on — the reverse of `qrLedgerMirror`, and
    // deliberately so: canonical production has no acquirer relationship to
    // announce, so the safe default is "this subsystem does not exist,"
    // not "on until proven otherwise."
    cardPaymentsEnabled: process.env.CARD_PAYMENTS_ENABLED === 'true',
  },
  purchasePolicy: {
    // 3 minutes, per spec §7 — long enough for a cashier mid-queue to glance
    // at their phone, short enough that a customer at the till is not left
    // standing on a stale hold.
    intentTimeoutSeconds: parseInt(
      process.env.PURCHASE_INTENT_TIMEOUT_SECONDS ?? '180',
      10,
    ),
    // 30/20/30/10/5/5 (TuTak/Green/Deferred/L1/L2/L3), per the 2026-08-22
    // 3-level referral rework (docs/NEXT_CLAUDE_TASK.md, GitHub issue #28
    // comment 5360139848) — six legs of the contribution pool in basis
    // points (not of the gross purchase — the pool is gross ×
    // negotiatedRateBps first, then split this way). Replaces the old
    // single-leg `poolReferrerBps`/20-30-20-30 split outright; a level with
    // no recipient (chain shorter than 3) has its share fold into TuTak's
    // own leg as a residual — see `ReferralService.computePoolSplit`, the
    // single place this split is actually computed.
    poolGreenBps: parseInt(process.env.PURCHASE_POOL_GREEN_BPS ?? '2000', 10),
    poolDeferredBps: parseInt(process.env.PURCHASE_POOL_DEFERRED_BPS ?? '3000', 10),
    poolReferrerL1Bps: parseInt(process.env.PURCHASE_POOL_REFERRER_L1_BPS ?? '1000', 10),
    poolReferrerL2Bps: parseInt(process.env.PURCHASE_POOL_REFERRER_L2_BPS ?? '500', 10),
    poolReferrerL3Bps: parseInt(process.env.PURCHASE_POOL_REFERRER_L3_BPS ?? '500', 10),
    poolTutakBps: parseInt(process.env.PURCHASE_POOL_TUTAK_BPS ?? '3000', 10),
    // 3 months / 54 000 AMD cumulative, per spec §13.
    deferredWindowMonths: parseInt(
      process.env.DEFERRED_BONUS_WINDOW_MONTHS ?? '3',
      10,
    ),
    deferredRequiredTurnover: process.env.DEFERRED_BONUS_REQUIRED_TURNOVER ?? '54000',
    // 10 000 AMD cumulative, no deadline, per spec §18.
    challengeQualificationAmount:
      process.env.REFERRAL_CHALLENGE_QUALIFICATION_AMOUNT ?? '10000',
    // 1000 AMD to each side, per spec §18.
    challengeRewardAmount: process.env.REFERRAL_CHALLENGE_REWARD_AMOUNT ?? '1000',
    // First 3 qualified friends, per spec §18.
    challengeSlotLimit: parseInt(process.env.REFERRAL_CHALLENGE_SLOT_LIMIT ?? '3', 10),
  },
});

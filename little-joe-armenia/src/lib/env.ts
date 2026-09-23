import "server-only";
import { z } from "zod";

const bool = z
  .enum(["true", "false", "1", "0", ""])
  .optional()
  .transform((v) => v === "true" || v === "1");

const optional = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== "" ? v.trim() : undefined));

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATABASE_URL: z.string().min(1),
    // Render sets RENDER_EXTERNAL_URL automatically; an explicit APP_URL
    // (custom domain) wins.
    APP_URL: z.string().url().default(process.env.RENDER_EXTERNAL_URL ?? "http://localhost:3000"),

    // Shown as the store name. Never hard-coded as "official".
    STORE_NAME: z.string().default("Little Joe Armenia"),
    // Must be explicitly set once brand authorisation is documented.
    BRAND_AUTHORIZED: bool,

    DEMO_MODE: bool,
    SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),

    // Customer sign-in delivery. "screen" shows the code in the UI and is
    // refused unless DEMO_MODE is on.
    AUTH_CODE_DELIVERY: z.enum(["console", "screen", "resend"]).default("console"),
    RESEND_API_KEY: optional,
    EMAIL_FROM: optional,

    // mock: IDRAM/TELCELL/BANK_CARD are simulated by the in-app sandbox.
    // live: only adapters with credentials are offered.
    PAYMENTS_MODE: z.enum(["mock", "live"]).default("mock"),
    MOCK_PAYMENT_SECRET: optional,
    IDRAM_REC_ACCOUNT: optional,
    IDRAM_SECRET_KEY: optional,
    IDRAM_PAYMENT_URL: z.string().url().default("https://banking.idram.am/Payment/GetPayment"),
    TELCELL_SHOP_ID: optional,
    TELCELL_SHOP_KEY: optional,
    TELCELL_API_URL: optional,
    CARD_ACQUIRER_API_URL: optional,
    CARD_ACQUIRER_USERNAME: optional,
    CARD_ACQUIRER_PASSWORD: optional,

    // db: photos stored in Postgres (no disk needed) · s3: bucket · local: dev only
    STORAGE_DRIVER: z.enum(["db", "local", "s3"]).default("db"),
    S3_ENDPOINT: optional,
    S3_REGION: z.string().default("auto"),
    S3_BUCKET: optional,
    S3_ACCESS_KEY_ID: optional,
    S3_SECRET_ACCESS_KEY: optional,
    S3_PUBLIC_BASE_URL: optional,

    CRON_SECRET: optional,
    RESERVATION_TTL_MINUTES: z.coerce.number().int().min(5).max(24 * 60).default(30),

    GOOGLE_SITE_VERIFICATION: optional,
  })
  .superRefine((env, ctx) => {
    if (env.AUTH_CODE_DELIVERY === "screen" && !env.DEMO_MODE) {
      ctx.addIssue({
        code: "custom",
        path: ["AUTH_CODE_DELIVERY"],
        message: "AUTH_CODE_DELIVERY=screen is only allowed with DEMO_MODE=true",
      });
    }
    if (env.PAYMENTS_MODE === "mock" && env.NODE_ENV === "production" && !env.DEMO_MODE) {
      ctx.addIssue({
        code: "custom",
        path: ["PAYMENTS_MODE"],
        message: "PAYMENTS_MODE=mock in production requires DEMO_MODE=true",
      });
    }
    if (env.AUTH_CODE_DELIVERY === "resend" && (!env.RESEND_API_KEY || !env.EMAIL_FROM)) {
      ctx.addIssue({ code: "custom", path: ["RESEND_API_KEY"], message: "RESEND_API_KEY and EMAIL_FROM are required" });
    }
  });

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function env(): Env {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n");
      throw new Error(`Invalid environment configuration:\n${issues}`);
    }
    cached = parsed.data;
  }
  return cached;
}

/** Test hook. */
export function resetEnvCache() {
  cached = undefined;
}

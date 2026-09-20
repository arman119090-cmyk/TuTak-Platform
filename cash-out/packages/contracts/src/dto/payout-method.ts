import { z } from 'zod';
import { currencySchema } from './common';

export const payoutMethodKindSchema = z.enum([
  /** A bank card, referenced only by a provider token — never by its PAN. */
  'CARD',
  /** A bank account addressed by IBAN or a local account number. */
  'BANK_ACCOUNT',
  /** An iDram wallet, addressed by its account id. */
  'IDRAM',
]);
export type PayoutMethodKind = z.infer<typeof payoutMethodKindSchema>;

export const payoutMethodStatusSchema = z.enum([
  'PENDING_VERIFICATION',
  'ACTIVE',
  'REJECTED',
  'DISABLED',
]);
export type PayoutMethodStatus = z.infer<typeof payoutMethodStatusSchema>;

export const payoutMethodSchema = z.object({
  id: z.string().uuid(),
  kind: payoutMethodKindSchema,
  status: payoutMethodStatusSchema,
  currency: currencySchema,
  /** "•••• 4242" or "•••• 7781" — the only part of the instrument we store. */
  maskedIdentifier: z.string(),
  /** Card brand, bank name or "iDram", for the UI. */
  displayName: z.string().nullable(),
  /** The holder's name as the provider reports it (iDram), for the recipient line. */
  holderName: z.string().nullable(),
  isDefault: z.boolean(),
  verifiedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type PayoutMethodDto = z.infer<typeof payoutMethodSchema>;

/**
 * Adding a card never sends card data to Cash Out. The app collects it inside
 * the provider's SDK/webview, the provider hands back a single-use token, and
 * only that token reaches this endpoint. Cash Out is therefore never in scope
 * for cardholder data.
 */
export const addCardPayoutMethodSchema = z.object({
  kind: z.literal('CARD'),
  providerToken: z.string().min(8).max(512),
  currency: currencySchema,
  setAsDefault: z.boolean().default(true),
});

export const addBankAccountPayoutMethodSchema = z.object({
  kind: z.literal('BANK_ACCOUNT'),
  /** Validated for shape only; the provider validates it for real. */
  accountIdentifier: z.string().min(8).max(64),
  bankCode: z.string().min(2).max(32).optional(),
  holderName: z.string().min(2).max(140),
  currency: currencySchema,
  setAsDefault: z.boolean().default(true),
});

/**
 * An iDram account id as the driver types it. The exact format iDram uses for
 * wallet ids is not confirmed by any documentation available to this project
 * (see docs/IDRAM_INTEGRATION.md); the shape check is deliberately loose and
 * the provider — mock or live — decides.
 */
export const idramAccountIdSchema = z
  .string()
  .trim()
  .min(5)
  .max(32)
  .regex(/^[0-9A-Za-z+]+$/, 'digits and letters only');

export const addIdramPayoutMethodSchema = z.object({
  kind: z.literal('IDRAM'),
  accountId: idramAccountIdSchema,
  holderName: z.string().trim().min(2).max(140).optional(),
  currency: currencySchema.default('AMD'),
  setAsDefault: z.boolean().default(true),
});
export type AddIdramPayoutMethodDto = z.infer<typeof addIdramPayoutMethodSchema>;

export const addPayoutMethodSchema = z.discriminatedUnion('kind', [
  addCardPayoutMethodSchema,
  addBankAccountPayoutMethodSchema,
  addIdramPayoutMethodSchema,
]);

/** What the driver links from Settings → iDram account. */
export const linkIdramAccountSchema = z.object({
  accountId: idramAccountIdSchema,
  holderName: z.string().trim().min(2).max(140).optional(),
});
export type LinkIdramAccountDto = z.infer<typeof linkIdramAccountSchema>;
export type AddPayoutMethodDto = z.infer<typeof addPayoutMethodSchema>;

import { z } from 'zod';
import { currencySchema } from './common';

export const payoutMethodKindSchema = z.enum([
  /** A bank card, referenced only by a provider token — never by its PAN. */
  'CARD',
  /** A bank account addressed by IBAN or a local account number. */
  'BANK_ACCOUNT',
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
  /** Card brand or bank name, for the UI. */
  displayName: z.string().nullable(),
  isDefault: z.boolean(),
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

export const addPayoutMethodSchema = z.discriminatedUnion('kind', [
  addCardPayoutMethodSchema,
  addBankAccountPayoutMethodSchema,
]);
export type AddPayoutMethodDto = z.infer<typeof addPayoutMethodSchema>;

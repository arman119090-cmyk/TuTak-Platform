import { z } from 'zod';
import { moneySchema, paginationSchema } from './common';
import { withdrawalSchema, withdrawalTimelineEntrySchema } from './withdrawal';

/**
 * What a line of balance history is.
 *
 *  - WITHDRAWAL: a payout the driver (or their rule) asked for; the amount is
 *    the gross taken from the park balance.
 *  - REFUND: a withdrawal that did not reach the driver and whose debit was
 *    put back.
 *  - ADMIN_ADJUSTMENT: an operator corrected what Cash Out owes the driver,
 *    with a written reason.
 *  - CREDIT / DEBIT: any other movement of the driver's balance that Cash Out
 *    learns of. Nothing produces these today: earnings accrue inside Yandex,
 *    and no documented Fleet API call lists them per driver. The types exist
 *    so the read model does not need a schema change when one does.
 */
export const historyEntryTypeSchema = z.enum([
  'CREDIT',
  'DEBIT',
  'WITHDRAWAL',
  'REFUND',
  'ADMIN_ADJUSTMENT',
]);
export type HistoryEntryType = z.infer<typeof historyEntryTypeSchema>;

export const userStatusSchema = z.enum(['COMPLETED', 'PROCESSING', 'CANCELLED', 'REJECTED']);

export const historyEntrySchema = z.object({
  /** `w:<withdrawalId>` or `j:<journalEntryId>`; the details endpoint takes it. */
  id: z.string(),
  /** What the driver quotes to support: the withdrawal reference or the entry id. */
  operationId: z.string(),
  type: historyEntryTypeSchema,
  status: userStatusSchema,
  /** Signed: negative when the balance went down. */
  amount: moneySchema,
  /** The park balance right after the operation, when Yandex reported it; null otherwise. */
  balanceAfter: moneySchema.nullable(),
  at: z.string().datetime(),
  comment: z.string().nullable(),
  origin: z.enum(['DRIVER', 'AUTO_PAYOUT', 'SYSTEM', 'ADMIN']),
  withdrawalId: z.string().uuid().nullable(),
  park: z.object({ id: z.string().uuid(), name: z.string() }).nullable(),
});
export type HistoryEntryDto = z.infer<typeof historyEntrySchema>;

export const historyFilterSchema = paginationSchema.extend({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  type: historyEntryTypeSchema.optional(),
  status: userStatusSchema.optional(),
});
export type HistoryFilter = z.infer<typeof historyFilterSchema>;

export const historyPageSchema = z.object({
  items: z.array(historyEntrySchema),
  nextCursor: z.string().nullable(),
});
export type HistoryPageDto = z.infer<typeof historyPageSchema>;

export const historyEntryDetailSchema = z.object({
  entry: historyEntrySchema,
  withdrawal: withdrawalSchema.nullable(),
  timeline: z.array(withdrawalTimelineEntrySchema),
  /** For a journal-backed entry: the balanced postings behind it. */
  postings: z.array(
    z.object({
      account: z.string(),
      direction: z.enum(['DEBIT', 'CREDIT']),
      amount: moneySchema,
    }),
  ),
});
export type HistoryEntryDetailDto = z.infer<typeof historyEntryDetailSchema>;

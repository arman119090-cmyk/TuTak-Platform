import { PspAttemptStatus } from '@prisma/client';

/**
 * Statuses in which the provider may already hold the customer's money.
 *
 * `EXPIRED` is in the list, and that is the point of the list. A timed-out
 * attempt feels like a failure and is not one: nothing authoritative said the
 * payment did not happen, so treating it as safe is how a customer ends up
 * paying twice. Only `FAILED` — an explicit provider denial — clears a
 * purchase for another route.
 *
 * It lives in a file of its own rather than inside `PspPaymentService`
 * because two different modules have to agree on it: the PSP service, which
 * refuses a second attempt on the same purchase, and `PurchaseIntentsService`,
 * which refuses a whole new purchase at the same business. Two copies of this
 * list would eventually differ, and the copy that quietly dropped `EXPIRED`
 * would be the one that let a customer pay twice.
 */
export const MONEY_MAY_HAVE_MOVED: readonly PspAttemptStatus[] = [
  PspAttemptStatus.INITIATED,
  PspAttemptStatus.PENDING_CONFIRMATION,
  PspAttemptStatus.SUCCEEDED,
  PspAttemptStatus.EXPIRED,
  PspAttemptStatus.REQUIRES_RECONCILIATION,
];

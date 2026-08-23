import { TransactionStatus, TransactionType, Currency } from '../enums/transaction';
import type { PartnerBrandDto } from './media';

export interface TransactionDto {
  id: string;
  userId: string;
  partnerId: string | null;
  type: TransactionType;
  status: TransactionStatus;
  amount: string;
  currency: Currency;
  bonusAppliedAmount: string;
  bonusEarnedAmount: string;
  description: string | null;
  metadata: Record<string, unknown> | null;
  /**
   * Who the customer was dealing with, as this operation recorded it — spec
   * §1.3/§2.2. The immutable snapshot, never the partner's brand as it stands
   * today: a partner that rebrands must not rewrite last March's receipt.
   *
   * Null only when the transaction has no partner at all (a manual
   * adjustment, an expiry sweep). A partner transaction written before the
   * media system existed still gets a `partnerBrand` — with the partner's
   * current display name and a null logo — because the customer still needs
   * to know where they spent.
   */
  partnerBrand: PartnerBrandDto | null;
  createdAt: string;
  updatedAt: string;
}

export interface TransactionHistoryQueryDto {
  userId?: string;
  partnerId?: string;
  type?: TransactionType;
  status?: TransactionStatus;
  from?: string;
  to?: string;
  cursor?: string;
  limit?: number;
}

export interface PaginatedResultDto<T> {
  items: T[];
  nextCursor: string | null;
  total?: number;
}

import { TransactionStatus, TransactionType, Currency } from '../enums/transaction';

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

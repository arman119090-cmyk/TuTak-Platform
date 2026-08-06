export interface TransactionCompletedEvent {
  transactionId: string;
  userId: string;
  partnerId: string | null;
  type: string;
  amount: string;
}

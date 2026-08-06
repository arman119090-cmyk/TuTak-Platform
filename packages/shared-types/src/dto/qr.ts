import { QrCodeStatus, QrCodeType } from '../enums/qr';

export interface IssueQrRequestDto {
  type: QrCodeType;
  partnerId?: string;
  amount?: string;
  expiresInSeconds?: number;
}

export interface QrCodeDto {
  id: string;
  type: QrCodeType;
  status: QrCodeStatus;
  token: string;
  issuedByUserId: string | null;
  partnerId: string | null;
  amount: string | null;
  expiresAt: string;
  createdAt: string;
}

export interface RedeemQrRequestDto {
  token: string;
  payerUserId: string;
  bonusAmountToApply?: string;
  idempotencyKey: string;
}

export interface RedeemQrResponseDto {
  transactionId: string;
  amountCharged: string;
  bonusApplied: string;
  bonusEarned: string;
}

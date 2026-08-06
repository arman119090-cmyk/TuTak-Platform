import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AuditAction, QrCodeStatus, QrCodeType, TransactionType } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { generateOpaqueToken } from '../../common/utils/crypto';
import { AuditService } from '../audit/audit.service';
import { BonusEngineService } from '../wallet/bonus-engine.service';
import { WalletService } from '../wallet/wallet.service';
import { TransactionsService } from '../transactions/transactions.service';
import { PartnersService } from '../partners/partners.service';
import { FraudDetectionService } from '../security/fraud-detection.service';
import { RequestUser } from '../auth/types/request-user.type';
import { BonusEntryType } from '@prisma/client';
import { IssueQrDto } from './dto/issue-qr.dto';
import { RedeemQrDto } from './dto/redeem-qr.dto';

@Injectable()
export class QrPaymentsService {
  private readonly logger = new Logger(QrPaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bonusEngine: BonusEngineService,
    private readonly walletService: WalletService,
    private readonly transactionsService: TransactionsService,
    private readonly partnersService: PartnersService,
    private readonly auditService: AuditService,
    private readonly fraudDetectionService: FraudDetectionService,
  ) {}

  async issue(dto: IssueQrDto, issuer: RequestUser) {
    if (dto.type !== QrCodeType.USER_PAY_TOKEN && !dto.partnerId) {
      throw new BadRequestException('partnerId is required for merchant-issued QR codes');
    }
    if (dto.type === QrCodeType.DYNAMIC_INVOICE && !dto.amount) {
      throw new BadRequestException('amount is required for a dynamic invoice QR code');
    }

    if (dto.partnerId) {
      await this.assertCanIssueForPartner(issuer, dto.partnerId);
    }

    const expiresInSeconds = dto.expiresInSeconds ?? (dto.type === QrCodeType.STATIC_MERCHANT ? 3153600000 : 900);

    const qr = await this.prisma.qrCode.create({
      data: {
        type: dto.type,
        token: generateOpaqueToken(24),
        issuedByUserId: dto.type === QrCodeType.USER_PAY_TOKEN ? issuer.id : null,
        partnerId: dto.partnerId,
        amount: dto.amount,
        expiresAt: new Date(Date.now() + expiresInSeconds * 1000),
      },
    });

    await this.auditService.record({
      actorUserId: issuer.id,
      action: AuditAction.QR_ISSUED,
      entityType: 'QrCode',
      entityId: qr.id,
      metadata: { type: qr.type, partnerId: qr.partnerId },
    });

    return qr;
  }

  /** Only an admin or a member of the partner may issue a merchant-scoped QR code. */
  private async assertCanIssueForPartner(issuer: RequestUser, partnerId: string) {
    const isAdmin = issuer.roles.includes('ADMIN') || issuer.roles.includes('SUPER_ADMIN');
    if (isAdmin) return;

    const isMember = await this.partnersService.isMember(partnerId, issuer.id);
    if (!isMember) {
      throw new ForbiddenException('You are not authorized to issue QR codes for this partner');
    }
  }

  /**
   * Redeems a QR code: charges the payer, optionally applies a bonus-point
   * discount, and accrues fresh bonus points on the paid (non-discounted)
   * portion at the partner's accrual rate. Idempotent on `idempotencyKey`.
   */
  async redeem(dto: RedeemQrDto, payerUserId: string) {
    const existing = await this.transactionsService.findByIdempotencyKey(dto.idempotencyKey);
    if (existing) {
      return {
        transactionId: existing.id,
        amountCharged: existing.amount.toString(),
        bonusApplied: existing.bonusAppliedAmount.toString(),
        bonusEarned: existing.bonusEarnedAmount.toString(),
      };
    }

    const qr = await this.prisma.qrCode.findUnique({ where: { token: dto.token } });
    if (!qr) throw new NotFoundException('QR code not found');
    if (qr.status !== QrCodeStatus.ACTIVE) throw new BadRequestException('QR code is not active');
    if (qr.expiresAt < new Date()) throw new BadRequestException('QR code has expired');

    const amount = qr.amount ?? new Decimal(0);
    if (amount.lessThanOrEqualTo(0)) {
      throw new BadRequestException('QR code has no payable amount set');
    }

    const bonusToApply = dto.bonusAmountToApply ? new Decimal(dto.bonusAmountToApply) : new Decimal(0);
    if (bonusToApply.greaterThan(amount)) {
      throw new BadRequestException('Bonus applied cannot exceed the payment amount');
    }

    const partnerId = qr.partnerId ?? undefined;
    const partner = partnerId ? await this.partnersService.findByIdOrThrow(partnerId) : null;

    const transaction = await this.transactionsService.create({
      userId: payerUserId,
      partnerId,
      type: TransactionType.QR_PAYMENT,
      amount,
      bonusAppliedAmount: bonusToApply,
      idempotencyKey: dto.idempotencyKey,
      description: `QR payment${partner ? ` at ${partner.displayName}` : ''}`,
    });

    await this.fraudDetectionService
      .checkVelocity(payerUserId, transaction.id)
      .catch((e) => this.logger.error('Fraud velocity check failed', e));

    let reservationId: string | null = null;
    try {
      if (bonusToApply.greaterThan(0)) {
        const walletId = await this.walletService.getWalletIdForUser(payerUserId);
        const reservation = await this.bonusEngine.reserve(walletId, bonusToApply, transaction.id);
        reservationId = reservation.reservationId;
        await this.bonusEngine.settleReservation(reservationId);
      }

      // Single-use QR types are consumed atomically; STATIC_MERCHANT stays reusable.
      if (qr.type !== QrCodeType.STATIC_MERCHANT) {
        const flip = await this.prisma.qrCode.updateMany({
          where: { id: qr.id, status: QrCodeStatus.ACTIVE },
          data: { status: QrCodeStatus.REDEEMED, redeemedTransactionId: transaction.id },
        });
        if (flip.count === 0) {
          throw new BadRequestException('QR code was already redeemed');
        }
      }

      let bonusEarned = new Decimal(0);
      if (partner) {
        const paidPortion = amount.minus(bonusToApply);
        bonusEarned = paidPortion.times(partner.bonusAccrualRateBps).dividedBy(10_000);
        if (bonusEarned.greaterThan(0)) {
          const payerWalletId = await this.walletService.getWalletIdForUser(payerUserId);
          await this.bonusEngine.accrue({
            walletId: payerWalletId,
            type: BonusEntryType.ACCRUAL_PURCHASE,
            amount: bonusEarned,
            sourceTransactionId: transaction.id,
          });
        }
      }

      const completed = await this.transactionsService.markCompleted(transaction.id, {
        bonusEarnedAmount: bonusEarned,
      });

      await this.auditService.record({
        actorUserId: payerUserId,
        action: AuditAction.QR_REDEEMED,
        entityType: 'QrCode',
        entityId: qr.id,
        metadata: { transactionId: transaction.id, amount: amount.toString() },
      });

      return {
        transactionId: completed.id,
        amountCharged: amount.toString(),
        bonusApplied: bonusToApply.toString(),
        bonusEarned: bonusEarned.toString(),
      };
    } catch (err) {
      if (reservationId) {
        await this.bonusEngine.releaseReservation(reservationId, 'qr_redeem_failed').catch((e) =>
          this.logger.error('Failed to release bonus reservation after QR redeem failure', e),
        );
      }
      await this.transactionsService.markFailed(
        transaction.id,
        err instanceof Error ? err.message : 'unknown_error',
      );
      throw err;
    }
  }
}

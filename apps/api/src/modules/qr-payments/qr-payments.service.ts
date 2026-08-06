import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AuditAction, QrCodeStatus, QrCodeType, TransactionType } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { generateOpaqueToken } from '../../common/utils/crypto';
import { parseMoney } from '../../common/utils/money';
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
        // Recorded for every type. Leaving it null on merchant codes meant
        // the self-redemption check below could not see who raised the
        // invoice, and the audit trail could not say either.
        issuedByUserId: issuer.id,
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
    // Idempotency is scoped to the caller. A global lookup let one account
    // replay another's key and receive that account's transaction back.
    const existing = await this.transactionsService.findByIdempotencyKey(
      payerUserId,
      dto.idempotencyKey,
    );
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

    // A payment needs two parties, and neither of them may be the merchant.
    //
    // Blocking only the issuer was not enough. Accrual is funded by the
    // partner, so anyone on the partner's side who can raise an invoice can
    // raise one against themselves for an amount they choose and collect the
    // accrual on it — 50,000 points a call at a 5% rate, repeatable. Blocking
    // just the issuer would also leave two staff members issuing for each
    // other, so membership is what is checked, not identity.
    if (qr.issuedByUserId && qr.issuedByUserId === payerUserId) {
      throw new BadRequestException('You cannot redeem a code you issued yourself');
    }
    if (qr.partnerId && (await this.partnersService.isMember(qr.partnerId, payerUserId))) {
      throw new BadRequestException(
        'You cannot redeem a code issued by the partner you belong to',
      );
    }

    const amount = qr.amount ?? new Decimal(0);
    if (amount.lessThanOrEqualTo(0)) {
      throw new BadRequestException('QR code has no payable amount set');
    }

    // parseMoney rejects negatives, NaN, Infinity and over-scale values. A
    // negative here used to invert `amount.minus(bonus)` into an addition,
    // inflating the accrual base without limit (audit §B1).
    const bonusToApply = dto.bonusAmountToApply
      ? parseMoney(dto.bonusAmountToApply, 'bonusAmountToApply')
      : new Decimal(0);
    if (bonusToApply.greaterThan(amount)) {
      throw new BadRequestException('Bonus applied cannot exceed the payment amount');
    }

    const partnerId = qr.partnerId ?? undefined;
    // Refuses a deactivated partner: a switched-off merchant must stop
    // redeeming and stop accruing, not merely look switched off (§H3).
    const partner = partnerId ? await this.partnersService.findActiveOrThrow(partnerId) : null;

    const transaction = await this.transactionsService.create({
      userId: payerUserId,
      partnerId,
      type: TransactionType.QR_PAYMENT,
      amount,
      bonusAppliedAmount: bonusToApply,
      idempotencyKey: dto.idempotencyKey,
      description: `QR payment${partner ? ` at ${partner.displayName}` : ''}`,
    });

    // The signal used to be raised and then dropped on the floor: nothing read
    // the return value and markFlagged was dead code, so velocity abuse
    // completed normally and was visible only in a table nobody watched (§H7).
    const anomalous = await this.fraudDetectionService
      .checkVelocity(payerUserId, transaction.id)
      .catch((e) => {
        this.logger.error('Fraud velocity check failed', e);
        return false;
      });
    if (anomalous) {
      await this.transactionsService.markFlagged(transaction.id, 'velocity_limit_exceeded');
      throw new BadRequestException(
        'This payment was held for review. Please try again shortly.',
      );
    }

    let reservationId: string | null = null;
    let accruedLotId: string | null = null;
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
          const lot = await this.bonusEngine.accrue({
            walletId: payerWalletId,
            type: BonusEntryType.ACCRUAL_PURCHASE,
            amount: bonusEarned,
            sourceTransactionId: transaction.id,
          });
          accruedLotId = lot.id;
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
      // Compensate whatever the saga already committed. `release` alone was
      // not enough: once the hold had been settled it threw, the error was
      // swallowed here, and the customer's points stayed spent against a
      // transaction that ended up FAILED.
      if (reservationId) {
        await this.bonusEngine
          .compensateReservation(reservationId, 'qr_redeem_failed')
          .catch((e) =>
            this.logger.error('Failed to compensate bonus reservation after QR redeem failure', e),
          );
      }
      if (accruedLotId) {
        await this.bonusEngine
          .reverseAccrualLot(accruedLotId, 'qr_redeem_failed')
          .catch((e) =>
            this.logger.error('Failed to reverse bonus accrual after QR redeem failure', e),
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

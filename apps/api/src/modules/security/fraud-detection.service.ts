import { Injectable, Logger } from '@nestjs/common';
import { FraudSignalSeverity, FraudSignalType, Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

const VELOCITY_WINDOW_MINUTES = 10;
const VELOCITY_MAX_TRANSACTIONS = 8;

/**
 * Lightweight rule-based fraud signal engine. Intentionally simple and
 * synchronous so it can run inline on the hot path without external
 * dependencies; the FraudSignal table is designed so a future ML scoring
 * job can write richer signals alongside these without a schema change.
 */
@Injectable()
export class FraudDetectionService {
  private readonly logger = new Logger(FraudDetectionService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Returns true if the user is currently transacting at an anomalous velocity. */
  async checkVelocity(userId: string, relatedTransactionId?: string): Promise<boolean> {
    const since = new Date(Date.now() - VELOCITY_WINDOW_MINUTES * 60_000);
    const recentCount = await this.prisma.transaction.count({
      where: { userId, createdAt: { gte: since } },
    });

    if (recentCount >= VELOCITY_MAX_TRANSACTIONS) {
      await this.raise({
        userId,
        type: FraudSignalType.VELOCITY_LIMIT_EXCEEDED,
        severity: FraudSignalSeverity.MEDIUM,
        relatedTransactionId,
        metadata: { recentCount, windowMinutes: VELOCITY_WINDOW_MINUTES },
      });
      return true;
    }
    return false;
  }

  async raise(params: {
    userId?: string;
    type: FraudSignalType;
    severity: FraudSignalSeverity;
    relatedTransactionId?: string;
    metadata?: Record<string, unknown>;
  }) {
    this.logger.warn(`Fraud signal raised: ${params.type} (${params.severity}) user=${params.userId}`);
    return this.prisma.fraudSignal.create({
      data: {
        userId: params.userId,
        type: params.type,
        severity: params.severity,
        relatedTransactionId: params.relatedTransactionId,
        metadata: (params.metadata ?? undefined) as Prisma.InputJsonValue,
      },
    });
  }

  listOpen() {
    return this.prisma.fraudSignal.findMany({
      where: { resolvedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  resolve(id: string, resolvedByUserId: string) {
    return this.prisma.fraudSignal.update({
      where: { id },
      data: { resolvedAt: new Date(), resolvedByUserId },
    });
  }
}

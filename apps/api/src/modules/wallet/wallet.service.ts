import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CursorPaginationQueryDto } from '../../common/dto/pagination.dto';

@Injectable()
export class WalletService {
  constructor(private readonly prisma: PrismaService) {}

  async getBalanceForUser(userId: string) {
    const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) {
      throw new NotFoundException('Wallet not found for user');
    }
    return wallet;
  }

  async getWalletIdForUser(userId: string): Promise<string> {
    const wallet = await this.prisma.wallet.findUniqueOrThrow({ where: { userId } });
    return wallet.id;
  }

  async getLedger(userId: string, query: CursorPaginationQueryDto) {
    const wallet = await this.prisma.wallet.findUniqueOrThrow({ where: { userId } });
    const items = await this.prisma.bonusLedgerEntry.findMany({
      where: { walletId: wallet.id },
      take: query.limit,
      ...(query.cursor ? { skip: 1, cursor: { id: query.cursor } } : {}),
      orderBy: { createdAt: 'desc' },
    });
    return {
      items,
      nextCursor: items.length === query.limit ? (items.at(-1)?.id ?? null) : null,
    };
  }

  async getLots(userId: string) {
    const wallet = await this.prisma.wallet.findUniqueOrThrow({ where: { userId } });
    return this.prisma.bonusLot.findMany({
      where: { walletId: wallet.id, remainingAmount: { gt: 0 } },
      orderBy: { expiresAt: 'asc' },
    });
  }
}

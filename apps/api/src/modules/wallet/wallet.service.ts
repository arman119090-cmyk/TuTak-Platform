import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CursorPaginationQueryDto } from '../../common/dto/pagination.dto';
import { MediaViewService } from '../media/media-view.service';

@Injectable()
export class WalletService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaViewService,
  ) {}

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

  /**
   * The customer's points ledger — spec §1.3's "wallet source rows when the
   * source is a partner".
   *
   * A ledger entry has no partner of its own; what it has is
   * `sourceTransactionId`, and the transaction is where the brand snapshot
   * lives. So the brand is resolved through that link, which also means a row
   * with no partner behind it — an expiry, a manual adjustment, a referral
   * reward — correctly gets `partnerBrand: null` rather than being attributed
   * to a business that had nothing to do with it.
   */
  async getLedger(userId: string, query: CursorPaginationQueryDto) {
    const wallet = await this.prisma.wallet.findUniqueOrThrow({ where: { userId } });
    const items = await this.prisma.bonusLedgerEntry.findMany({
      where: { walletId: wallet.id },
      take: query.limit,
      ...(query.cursor ? { skip: 1, cursor: { id: query.cursor } } : {}),
      orderBy: { createdAt: 'desc' },
    });

    const sourceIds = [...new Set(items.map((i) => i.sourceTransactionId).filter((id): id is string => !!id))];
    const sources = sourceIds.length
      ? await this.prisma.transaction.findMany({
          where: { id: { in: sourceIds } },
          select: { id: true, partnerId: true, brandDisplayName: true, brandLogoAssetId: true },
        })
      : [];
    const brands = await this.media.brandsFor(sources);
    const brandByTransactionId = new Map(sources.map((source) => [source.id, brands.get(source) ?? null]));

    return {
      items: items.map((entry) => ({
        ...entry,
        partnerBrand: entry.sourceTransactionId
          ? (brandByTransactionId.get(entry.sourceTransactionId) ?? null)
          : null,
      })),
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

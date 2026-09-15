import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PermissionName } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CursorPaginationQueryDto } from '../../common/dto/pagination.dto';
import { RequestUser } from '../auth/types/request-user.type';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '@prisma/client';
import { BonusEngineService } from './bonus-engine.service';
import { WalletService } from './wallet.service';
import { ManualAdjustmentDto } from './dto/manual-adjustment.dto';
import { UsersService } from '../users/users.service';

@ApiTags('wallet')
@ApiBearerAuth()
@Controller('wallet')
export class WalletController {
  constructor(
    private readonly walletService: WalletService,
    private readonly bonusEngine: BonusEngineService,
    private readonly usersService: UsersService,
    private readonly auditService: AuditService,
  ) {}

  @Get('me')
  getMyWallet(@CurrentUser() user: RequestUser) {
    return this.walletService.getBalanceForUser(user.id);
  }

  @Get('me/ledger')
  getMyLedger(@CurrentUser() user: RequestUser, @Query() query: CursorPaginationQueryDto) {
    return this.walletService.getLedger(user.id, query);
  }

  @Get('me/lots')
  getMyLots(@CurrentUser() user: RequestUser) {
    return this.walletService.getLots(user.id);
  }

  @Post('admin/adjust')
  @RequirePermissions(PermissionName.WALLET_WRITE)
  async manualAdjust(@CurrentUser() admin: RequestUser, @Body() dto: ManualAdjustmentDto) {
    const targetUser = await this.usersService.findById(dto.userId);
    if (!targetUser) {
      throw new Error('Target user not found');
    }
    const walletId = await this.walletService.getWalletIdForUser(dto.userId);
    const result = await this.bonusEngine.manualAdjustment(walletId, dto.amount, dto.direction, dto.reason);

    await this.auditService.record({
      actorUserId: admin.id,
      action: AuditAction.BONUS_MANUAL_ADJUSTMENT,
      entityType: 'Wallet',
      entityId: walletId,
      metadata: { amount: dto.amount, direction: dto.direction, reason: dto.reason },
    });

    return result;
  }
}

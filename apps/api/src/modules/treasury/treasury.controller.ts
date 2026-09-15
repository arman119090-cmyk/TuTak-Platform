import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Currency, PermissionName } from '@prisma/client';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { TreasuryService } from './treasury.service';

/**
 * The figure somebody should look at before authorising a bank transfer.
 *
 * Read-only, and that is not a limitation to be lifted later: Arman's
 * decision is that transfers are made by a human in a banking app, so the
 * platform's job here is to tell them the truth about what is in the account,
 * not to move it.
 */
@ApiTags('treasury')
@ApiBearerAuth()
@Controller('admin/treasury')
export class TreasuryController {
  constructor(private readonly treasury: TreasuryService) {}

  @Get('position')
  @RequirePermissions(PermissionName.TREASURY_READ)
  async position(@Query('currency') currency?: Currency) {
    return this.treasury.position(currency ?? Currency.AMD);
  }
}

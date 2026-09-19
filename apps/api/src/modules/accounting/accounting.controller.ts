import { Controller, Get, Header, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PermissionName } from '@prisma/client';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { AccountingService } from './accounting.service';

/**
 * Files the bookkeeper opens.
 *
 * `LEDGER_READ`, the same permission that guards reading the books in the
 * admin panel — an export is a read of the ledger in a different shape, and
 * giving it a gentler permission would make the file the easy way around the
 * guard.
 *
 * Returned as a download rather than JSON: the caller is a person with a
 * spreadsheet, not a program.
 */
@ApiTags('accounting')
@ApiBearerAuth()
@Controller('admin/accounting')
export class AccountingController {
  constructor(private readonly accounting: AccountingService) {}

  @Get('ledger.csv')
  @RequirePermissions(PermissionName.LEDGER_READ)
  @Header('content-type', 'text/csv; charset=utf-8')
  async ledger(
    @Query('from') from: string,
    @Query('until') until: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const period = this.accounting.parsePeriod(from, until);
    res.setHeader(
      'content-disposition',
      `attachment; filename="tutak-ledger-${from}-${until}.csv"`,
    );
    return this.accounting.ledgerCsv(period);
  }

  @Get('settlements.csv')
  @RequirePermissions(PermissionName.LEDGER_READ)
  @Header('content-type', 'text/csv; charset=utf-8')
  async settlements(
    @Query('from') from: string,
    @Query('until') until: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const period = this.accounting.parsePeriod(from, until);
    res.setHeader(
      'content-disposition',
      `attachment; filename="tutak-settlements-${from}-${until}.csv"`,
    );
    return this.accounting.settlementsCsv(period);
  }
}

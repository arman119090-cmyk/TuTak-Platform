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

  /**
   * Streamed, not buffered.
   *
   * `passthrough: false` here on purpose: this handler writes the response
   * itself, a batch at a time, so a year of postings never exists in memory
   * as one array and one string in a process that is also serving customers.
   * The first buffering version of this was a defect that test data could
   * not show.
   *
   * The filename is built from the parsed period rather than the raw query,
   * so a caller cannot put arbitrary text — or a quote, or a newline — into
   * a `content-disposition` header.
   */
  @Get('ledger.csv')
  @RequirePermissions(PermissionName.LEDGER_READ)
  async ledger(@Query('from') from: string, @Query('until') until: string, @Res() res: Response) {
    const period = this.accounting.parsePeriod(from, until);
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader('content-disposition', `attachment; filename="${filenameFor('ledger', period)}"`);

    for await (const row of this.accounting.ledgerRows(period)) {
      // Back-pressure: when the socket's buffer is full, wait for it to
      // drain rather than queueing the rest of the export in memory, which
      // would defeat the point of streaming at all.
      if (!res.write(row + '\r\n')) {
        await new Promise<void>((resolve) => res.once('drain', resolve));
      }
    }
    res.end();
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
      `attachment; filename="${filenameFor('settlements', period)}"`,
    );
    return this.accounting.settlementsCsv(period);
  }
}

/**
 * A filename built from the parsed dates, never from the raw query string.
 *
 * `content-disposition` is a header a caller must not be able to write into:
 * a quote or a newline in a filename is header injection. Parsing first and
 * formatting the `Date` back out means only digits and dashes can reach it.
 */
function filenameFor(what: string, period: { from: Date; until: Date }): string {
  const day = (d: Date) => d.toISOString().slice(0, 10);
  return `tutak-${what}-${day(period.from)}-${day(period.until)}.csv`;
}

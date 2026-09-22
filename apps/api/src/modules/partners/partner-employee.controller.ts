import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UuidParam } from '../../common/decorators/uuid-param.decorator';
import { assertPartnerScope } from '../../common/auth/partner-scope';
import { branchFilterFor } from '../../common/auth/branch-scope';
import { RequestUser } from '../auth/types/request-user.type';
import { PartnerEmployeeService } from './partner-employee.service';

/**
 * Turning the code on a receipt back into a person.
 *
 * A statement line and a confirmed purchase both name `EMP-007` and nothing
 * else — deliberately, because a platform user id means nothing to the
 * partner reading it and a name on every row is more personal data on more
 * screens than the row needs. This is the one place that resolves it, and it
 * resolves it only for people entitled to the answer: see
 * `PartnerEmployeeService.cardFor` for the two grounds and why an unresolved
 * code is a 404 rather than a 403.
 */
@ApiTags('partner-employees')
@ApiBearerAuth()
@Controller('partners/:id/employees')
export class PartnerEmployeeController {
  constructor(private readonly employees: PartnerEmployeeService) {}

  /**
   * No permission decorator beyond partner scope, on purpose. Reading who
   * confirmed a sale is not reading the organisation's money — that is
   * `SETTLEMENT_READ`, and it stays where it is. A cashier settling a
   * dispute about this morning's receipt needs the name on it; the narrowing
   * in `cardFor` is what keeps that from becoming the whole staff directory.
   */
  @Get(':code')
  async byCode(
    @CurrentUser() user: RequestUser,
    @UuidParam('id') partnerId: string,
    @Param('code') code: string,
  ) {
    assertPartnerScope(user, partnerId);
    const card = await this.employees.cardFor(
      partnerId,
      code,
      branchFilterFor(user, partnerId),
    );
    if (!card) {
      throw new NotFoundException('No such employee');
    }
    return card;
  }
}

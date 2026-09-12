import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID, Matches } from 'class-validator';

/**
 * What a cashier types at the till: the business they work for, and the four
 * digits the customer just read out.
 *
 * The pattern is enforced here rather than in the service so a malformed
 * code never reaches the database as a query — and so the error a cashier
 * sees for "12" is about the code being four digits, not "nothing found",
 * which would send them looking for a purchase that was never there.
 */
export class FindPurchaseIntentByCodeDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  partnerId!: string;

  @ApiProperty({ example: '0042', description: 'Exactly four digits, leading zeros included' })
  @IsString()
  @Matches(/^\d{4}$/, { message: 'code must be exactly four digits' })
  code!: string;
}

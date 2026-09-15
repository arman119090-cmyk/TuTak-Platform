import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, Length, Matches, IsEnum } from 'class-validator';
import { RefundRequestStatus } from '@prisma/client';

/** What a cashier fills in when a customer brings something back. */
export class CreateRefundRequestDto {
  @ApiPropertyOptional({
    description: 'Merchandise amount to return. Omit to ask for whatever is still refundable.',
    example: '1500.00',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{1,12}(\.\d{1,4})?$/, { message: 'amount must be a positive decimal' })
  amount?: string;

  @ApiProperty({ description: 'Why the customer is bringing it back', example: 'Wrong size' })
  @IsString()
  @Length(3, 500)
  reason!: string;
}

/** The decision an owner or manager records when turning a request down. */
export class RejectRefundRequestDto {
  @ApiPropertyOptional({ description: 'What to tell the cashier who asked', example: 'Bring the receipt' })
  @IsOptional()
  @IsString()
  @Length(1, 500)
  note?: string;
}

/** The approver's queue filter. */
export class ListRefundRequestsDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  partnerId!: string;

  @ApiPropertyOptional({ enum: RefundRequestStatus })
  @IsOptional()
  @IsEnum(RefundRequestStatus)
  status?: RefundRequestStatus;
}

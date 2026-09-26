import { IsIn, IsOptional, IsString, Length } from 'class-validator';
import { IsMoneyString } from '../../../common/validators/is-money-string.validator';

export class ResolveDisputeDto {
  @IsIn(['RESOLVED_CUSTOMER', 'RESOLVED_PARTNER', 'RESOLVED_SPLIT'])
  outcome: 'RESOLVED_CUSTOMER' | 'RESOLVED_PARTNER' | 'RESOLVED_SPLIT';

  @IsMoneyString({ allowZero: false })
  @IsOptional()
  customerRefundAmount?: string;

  @IsString()
  @Length(3, 2000)
  note: string;
}

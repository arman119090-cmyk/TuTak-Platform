import { ArrayMaxSize, IsArray, IsIn, IsNumberString, IsOptional, IsString, IsUrl, Length } from 'class-validator';

/** Item 7: optional courier details (name, phone, tracking) — the courier needs no TuTak account. */
export class OutForDeliveryDto {
  @IsString()
  @Length(1, 500)
  @IsOptional()
  courierNote?: string;
}

/** Item 8: an actual cancellation cost the partner already incurred. */
export class ClaimCancellationCostDto {
  @IsNumberString()
  amount: string;

  @IsString()
  @Length(3, 500)
  reason: string;

  @IsString()
  @Length(1, 2000)
  @IsOptional()
  evidence?: string;

  @IsArray()
  @ArrayMaxSize(10)
  @IsUrl({ require_protocol: true }, { each: true })
  @IsOptional()
  evidenceUrls?: string[];
}

/** Item 8: the TuTak admin's decision on a claimed cost. */
export class DecideCancellationCostDto {
  @IsIn(['APPROVE', 'REDUCE', 'REJECT'])
  decision: 'APPROVE' | 'REDUCE' | 'REJECT';

  @IsNumberString()
  @IsOptional()
  approvedAmount?: string;

  @IsString()
  @Length(3, 1000)
  note: string;
}

/** Q9: the desk settlement, echoing the amount the employee was shown. */
export class SettleShortfallDto {
  @IsNumberString()
  collectedAmount: string;
}

export class RefuseShortfallDto {
  @IsString()
  @Length(3, 1000)
  note: string;
}

/** Q9: the operator's decision on a refused shortfall. */
export class ReviewShortfallDto {
  @IsIn(['WITHDRAW', 'REOPEN'])
  decision: 'WITHDRAW' | 'REOPEN';

  @IsString()
  @Length(3, 1000)
  note: string;
}

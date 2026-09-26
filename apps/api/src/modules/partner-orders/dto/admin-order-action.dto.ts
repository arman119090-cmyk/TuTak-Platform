import { IsString, Length } from 'class-validator';

/** Every manual admin decision on an order carries its reason into the AuditLog. */
export class AdminOrderActionDto {
  @IsString()
  @Length(3, 500)
  reason: string;
}

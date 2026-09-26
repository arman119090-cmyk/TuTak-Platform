import { IsUUID } from 'class-validator';

export class StartShiftDto {
  @IsUUID()
  branchId!: string;
}

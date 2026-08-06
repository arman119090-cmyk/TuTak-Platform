import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { RoleName } from '@prisma/client';

export class AssignRoleDto {
  @IsUUID()
  userId: string;

  @IsEnum(RoleName)
  role: RoleName;

  @IsOptional()
  @IsUUID()
  partnerId?: string;
}

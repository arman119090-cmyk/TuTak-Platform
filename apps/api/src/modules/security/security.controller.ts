import { Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PermissionName } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { RequestUser } from '../auth/types/request-user.type';
import { FraudDetectionService } from './fraud-detection.service';

@ApiTags('admin/security')
@ApiBearerAuth()
@Controller('admin/fraud-signals')
export class SecurityController {
  constructor(private readonly fraudDetectionService: FraudDetectionService) {}

  @Get()
  @RequirePermissions(PermissionName.ADMIN_AUDIT_READ)
  listOpen() {
    return this.fraudDetectionService.listOpen();
  }

  @Post(':id/resolve')
  @RequirePermissions(PermissionName.ADMIN_AUDIT_READ)
  resolve(@CurrentUser() admin: RequestUser, @Param('id') id: string) {
    return this.fraudDetectionService.resolve(id, admin.id);
  }
}

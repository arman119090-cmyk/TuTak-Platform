import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PermissionName } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CursorPaginationQueryDto } from '../../common/dto/pagination.dto';

@ApiTags('admin/audit')
@Controller('admin/audit-logs')
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermissions(PermissionName.ADMIN_AUDIT_READ)
  async list(@Query() query: CursorPaginationQueryDto) {
    const items = await this.prisma.auditLog.findMany({
      take: query.limit,
      ...(query.cursor ? { skip: 1, cursor: { id: query.cursor } } : {}),
      orderBy: { createdAt: 'desc' },
      include: { actor: { select: { id: true, firstName: true, lastName: true, phone: true } } },
    });

    return {
      items,
      nextCursor: items.length === query.limit ? (items.at(-1)?.id ?? null) : null,
    };
  }
}

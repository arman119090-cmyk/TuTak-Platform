import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService, TransactionClient } from '../../prisma/prisma.service';
import { requestContext } from '../../common/request-context';

export interface AuditInput {
  readonly action: string;
  readonly subjectType: string;
  readonly subjectId?: string;
  readonly actorType?: 'DRIVER' | 'ADMIN' | 'SYSTEM' | 'PROVIDER';
  readonly actorId?: string;
  readonly reason?: string;
  readonly before?: Prisma.InputJsonValue;
  readonly after?: Prisma.InputJsonValue;
}

/**
 * The audit log.
 *
 * Written inside the same transaction as the change it describes whenever a
 * transaction is available, so there is no window in which the change exists and
 * the record of it does not. The table rejects UPDATE and DELETE at the database
 * level.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: AuditInput, tx?: TransactionClient): Promise<void> {
    const context = requestContext.get();
    const client = tx ?? this.prisma;

    await client.auditLog.create({
      data: {
        action: input.action,
        subjectType: input.subjectType,
        subjectId: input.subjectId ?? null,
        actorType: input.actorType ?? inferActorType(context),
        actorId: input.actorId ?? context?.adminUserId ?? context?.userId ?? null,
        reason: input.reason ?? null,
        before: input.before ?? Prisma.DbNull,
        after: input.after ?? Prisma.DbNull,
        ip: context?.ip ?? null,
        userAgent: context?.userAgent ?? null,
        requestId: context?.requestId ?? null,
      },
    });
  }
}

function inferActorType(
  context: ReturnType<typeof requestContext.get>,
): 'DRIVER' | 'ADMIN' | 'SYSTEM' {
  if (context?.adminUserId) return 'ADMIN';
  if (context?.userId) return 'DRIVER';
  return 'SYSTEM';
}

import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { applyPoolSettings } from './database-url';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    const databaseUrl = process.env.DATABASE_URL;
    super({
      log: [
        { emit: 'event', level: 'warn' },
        { emit: 'event', level: 'error' },
      ],
      // Only when the deployment has stated a limit; otherwise this is the
      // same URL Prisma would have read for itself, and the same default
      // pool. See `database-url.ts` for why no number is invented here.
      ...(databaseUrl
        ? { datasources: { db: { url: applyPoolSettings(databaseUrl) } } }
        : {}),
    });
  }

  async onModuleInit() {
    // @ts-expect-error prisma event typing is generic over log levels
    this.$on('warn', (e: unknown) => this.logger.warn(e));
    // @ts-expect-error prisma event typing is generic over log levels
    this.$on('error', (e: unknown) => this.logger.error(e));
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}

import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log: [
        { emit: 'event', level: 'warn' },
        { emit: 'event', level: 'error' },
      ],
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

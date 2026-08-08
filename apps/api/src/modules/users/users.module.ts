import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AccountDeletionService } from './account-deletion.service';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';

@Module({
  imports: [AuditModule],
  providers: [UsersService, AccountDeletionService],
  controllers: [UsersController],
  exports: [UsersService, AccountDeletionService],
})
export class UsersModule {}

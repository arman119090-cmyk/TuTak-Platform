import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { MediaModule } from '../media/media.module';
import { AccountDeletionService } from './account-deletion.service';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';

@Module({
  imports: [AuditModule, MediaModule],
  providers: [UsersService, AccountDeletionService],
  controllers: [UsersController],
  exports: [UsersService, AccountDeletionService],
})
export class UsersModule {}

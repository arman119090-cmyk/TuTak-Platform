import { Module } from '@nestjs/common';
import { FraudDetectionService } from './fraud-detection.service';
import { SecurityController } from './security.controller';

@Module({
  controllers: [SecurityController],
  providers: [FraudDetectionService],
  exports: [FraudDetectionService],
})
export class SecurityModule {}

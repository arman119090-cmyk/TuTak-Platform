import { Global, Module } from '@nestjs/common';
import { CryptoService } from './crypto.service';
import { KeyRotationService } from './key-rotation.service';

@Global()
@Module({
  providers: [CryptoService, KeyRotationService],
  exports: [CryptoService, KeyRotationService],
})
export class CryptoModule {}

import { Global, Module } from '@nestjs/common';
import { IntegrationHealthRecorder } from './integration-health.recorder';

@Global()
@Module({
  providers: [IntegrationHealthRecorder],
  exports: [IntegrationHealthRecorder],
})
export class IntegrationHealthModule {}

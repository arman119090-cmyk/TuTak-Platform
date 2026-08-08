import { Module } from '@nestjs/common';
import { RetentionService } from './retention.service';

/**
 * No controller. Retention is not something anyone asks for over HTTP — it is
 * a promise the platform keeps on a schedule, driven by the `retention.prune`
 * sweep.
 */
@Module({
  providers: [RetentionService],
  exports: [RetentionService],
})
export class RetentionModule {}

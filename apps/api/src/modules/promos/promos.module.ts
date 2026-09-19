import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { MediaModule } from '../media/media.module';
import { AdminPromosController } from './admin-promos.controller';
import { PromosController } from './promos.controller';
import { PromosService } from './promos.service';

/** Home "Partner Spotlight": curated featured-partner placements. */
@Module({
  imports: [AuditModule, MediaModule],
  controllers: [PromosController, AdminPromosController],
  providers: [PromosService],
})
export class PromosModule {}

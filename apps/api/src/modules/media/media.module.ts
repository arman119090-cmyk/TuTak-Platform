import { Module } from '@nestjs/common';
import { MediaStorageModule } from '../../infrastructure/media/media-storage.module';
import { AuditModule } from '../audit/audit.module';
import { AdminMediaController } from './admin-media.controller';
import { MediaDeliveryController } from './media-delivery.controller';
import { MediaViewService } from './media-view.service';
import { MediaService } from './media.service';
import { PartnerMediaController } from './partner-media.controller';
import { UserAvatarController } from './user-avatar.controller';

/**
 * The media domain: uploads, approval, revocation, consent and delivery.
 *
 * `MediaViewService` is exported because almost every other module needs it —
 * partners, transactions, purchase intents, EV charging, wallet and referral
 * all carry media in their DTOs now, and all of them must resolve it the same
 * way. It is the read side and holds no write path, so exporting it widely
 * costs nothing.
 */
@Module({
  imports: [MediaStorageModule, AuditModule],
  controllers: [
    MediaDeliveryController,
    PartnerMediaController,
    UserAvatarController,
    AdminMediaController,
  ],
  providers: [MediaService, MediaViewService],
  exports: [MediaService, MediaViewService],
})
export class MediaModule {}

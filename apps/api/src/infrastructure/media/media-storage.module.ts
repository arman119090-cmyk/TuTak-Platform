import { isProductionDeployment } from '../../config/app-environment';
import * as path from 'node:path';
import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/configuration';
import { LocalDiskMediaStorage } from './local-disk-media-storage';
import { MediaDeliveryService } from './media-delivery.service';
import { MediaImageService } from './media-image.service';
import { MEDIA_STORAGE, MediaStorage } from './media-storage.interface';
import { MemoryMediaStorage } from './memory-media-storage';
import { S3MediaStorage } from './s3-media-storage';

/**
 * Chooses the storage backend, and refuses to boot rather than choose badly.
 *
 * Same shape and same discipline as `SmsModule` and `PushModule`: a
 * development default that needs no external service, and a production guard
 * that will not start the process on it. The failure this prevents is quieter
 * than a missing SMS carrier and worse to discover late — a production API on
 * the local-disk driver looks completely healthy. Uploads succeed. The image
 * comes back on the replica that handled the upload. Then the load balancer
 * sends the next request to the other replica and half the partner logos on
 * the network are 404s; the backup restores the database and *every* logo is
 * a 404, because the bytes were never in anything that gets backed up.
 *
 * So: outside production, local disk (or the in-memory fake under Jest).
 * In production, `MEDIA_STORAGE_DRIVER=s3` with real credentials, or the
 * process does not start.
 *
 * Demo mode is **not** exempt here, unlike the carrier and the acquirer.
 * Those are exempt because a demonstration has no contract with a bank or a
 * telco and nothing is lost by faking them. Object storage has no such
 * excuse: an S3-compatible bucket costs cents, the demo stack's own images
 * disappearing on the next redeploy would be visible to exactly the audience
 * the demo exists for, and nothing about "this is a demonstration" makes a
 * container filesystem durable.
 */
@Global()
@Module({
  providers: [
    {
      provide: MEDIA_STORAGE,
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>): MediaStorage => {
        const media = config.get('media', { infer: true });
        const isProduction = isProductionDeployment(config.get('appEnv', { infer: true }));
        const logger = new Logger('MediaStorage');

        if (isProduction && media.driver !== 's3') {
          throw new Error(
            `MEDIA_STORAGE_DRIVER is "${media.driver}" in production. Partner logos and customer ` +
              'avatars must live in durable object storage: the local-disk driver is not shared ' +
              'between replicas, is not covered by database backups, and does not survive a ' +
              'redeploy — every MediaAsset row would outlive the bytes it points at. Set ' +
              'MEDIA_STORAGE_DRIVER=s3 with MEDIA_STORAGE_S3_ENDPOINT, _BUCKET, _REGION, ' +
              '_ACCESS_KEY_ID and _SECRET_ACCESS_KEY.',
          );
        }

        if (isProduction && !process.env.MEDIA_PUBLIC_BASE_URL) {
          throw new Error(
            'MEDIA_PUBLIC_BASE_URL must be set in production — every logo and avatar URL this API ' +
              'hands to the mobile app and the dashboards is built on it, and the development ' +
              'default is localhost.',
          );
        }

        if (media.driver === 's3') {
          const missing = (
            [
              ['MEDIA_STORAGE_S3_ENDPOINT', media.s3.endpoint],
              ['MEDIA_STORAGE_S3_BUCKET', media.s3.bucket],
              ['MEDIA_STORAGE_S3_REGION', media.s3.region],
              ['MEDIA_STORAGE_S3_ACCESS_KEY_ID', media.s3.accessKeyId],
              ['MEDIA_STORAGE_S3_SECRET_ACCESS_KEY', media.s3.secretAccessKey],
            ] as const
          )
            .filter(([, value]) => !value)
            .map(([name]) => name);
          if (missing.length > 0) {
            throw new Error(
              `MEDIA_STORAGE_DRIVER=s3 but ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not set.`,
            );
          }
          logger.log(`Using S3-compatible object storage (bucket ${media.s3.bucket})`);
          return new S3MediaStorage(media.s3);
        }

        if (media.driver === 'memory') {
          if (isProduction) {
            // Unreachable — the driver check above already refused — but a
            // second, explicit refusal costs nothing and this is the one
            // driver where "it worked in the tests" is literally true.
            throw new Error('The in-memory media driver is for tests only');
          }
          logger.warn('Using the in-memory media driver — nothing written here survives a restart');
          return new MemoryMediaStorage();
        }

        const root = path.resolve(process.cwd(), media.localRoot);
        logger.warn(
          `Using the local-disk media driver at ${root}. Development only — this is not durable ` +
            'and is not shared between replicas.',
        );
        return new LocalDiskMediaStorage(root);
      },
    },
    MediaImageService,
    MediaDeliveryService,
  ],
  exports: [MEDIA_STORAGE, MediaImageService, MediaDeliveryService],
})
export class MediaStorageModule {}

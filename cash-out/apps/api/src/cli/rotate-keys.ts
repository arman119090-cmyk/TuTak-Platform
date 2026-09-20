import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { KeyRotationService } from '../common/crypto/key-rotation.service';
import { loadEnv } from '../config/env';

/**
 * Re-encrypts every ciphertext column under the active ENCRYPTION_KEY.
 *
 *   pnpm --filter @cashout/api rotate-keys -- --dry-run     count and verify, write nothing
 *   pnpm --filter @cashout/api rotate-keys                  re-encrypt
 *   pnpm --filter @cashout/api rotate-keys -- --inventory   rows per key id, per column
 *
 * Procedure (docs/OPERATIONS.md, "Key rotation"): deploy with the new key as
 * ENCRYPTION_KEY / ENCRYPTION_KEY_ID and the old one in
 * ENCRYPTION_PREVIOUS_KEYS; run --dry-run; run for real; run --inventory and
 * confirm zero rows under the old id; only then drop it from
 * ENCRYPTION_PREVIOUS_KEYS.
 */
async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const env = loadEnv();
  const app = await NestFactory.createApplicationContext(
    AppModule.register({ env, enableScheduler: false }),
    { logger: ['error', 'warn'] },
  );
  try {
    const rotation = app.get(KeyRotationService);
    if (args.has('--inventory')) {
      console.log(JSON.stringify(await rotation.inventory(), null, 2));
      return;
    }
    const report = await rotation.run({ dryRun: args.has('--dry-run') });
    console.log(JSON.stringify(report, null, 2));
    if (report.status !== 'COMPLETED') process.exitCode = 2;
  } finally {
    await app.close();
  }
}

void main();

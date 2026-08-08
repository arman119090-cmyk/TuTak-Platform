/**
 * Prisma's seed entry point, kept as a thin wrapper.
 *
 * The logic lives in `src/scripts/seed-baseline.ts` so that `nest build`
 * compiles it into `dist/` and the runtime image can run it without a
 * TypeScript toolchain. This file exists for `prisma db seed` and for local
 * development, where ts-node is available anyway.
 */
import { PrismaClient } from '@prisma/client';
import { seedBaseline } from '../src/scripts/seed-baseline';

const prisma = new PrismaClient();

seedBaseline(prisma)
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

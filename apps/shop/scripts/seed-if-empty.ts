/**
 * Seeds the demo data only when the database is still empty.
 *
 * A hosted demo re-runs its build on every deploy, and the seed wipes the
 * tables before filling them — so seeding unconditionally would throw away the
 * orders and requests a visitor created between deploys. Checking first keeps
 * a fresh database usable immediately without erasing a live demonstration.
 * Force a rebuild of the demo data with `npm run seed`.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const main = async (): Promise<void> => {
  const products = await prisma.product.count();
  if (products > 0) {
    console.log(`Database already holds ${products} products — skipping the seed.`);
    return;
  }
  console.log('Empty database — seeding the demo data.');
  await import('../prisma/seed');
};

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

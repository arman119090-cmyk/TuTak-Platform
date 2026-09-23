import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

// Direct client for arranging/asserting test data. The app code under test
// uses its own client from src/lib/db.ts against the same database.
export const testDb = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

/** Empties every application table (test database only). */
export async function resetDb() {
  if (!/_test\b|_test\?|lj_test/.test(process.env.DATABASE_URL ?? "")) {
    throw new Error("resetDb refused: DATABASE_URL does not look like a test database");
  }
  const rows = await testDb.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  const list = rows.map((r) => `"public"."${r.tablename}"`).join(", ");
  if (list) await testDb.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
}

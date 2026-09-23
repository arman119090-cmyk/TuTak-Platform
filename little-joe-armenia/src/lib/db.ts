import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

declare global {
  var __ljPrisma: PrismaClient | undefined;
}

function create() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  return new PrismaClient({ adapter });
}

// One client per process; reused across hot reloads in development.
export const db: PrismaClient = globalThis.__ljPrisma ?? create();
if (process.env.NODE_ENV !== "production") globalThis.__ljPrisma = db;

export type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

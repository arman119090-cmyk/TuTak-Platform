import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db, type Tx } from "@/lib/db";

export type AuditEntry = {
  actor: string;
  action: string;
  entity: string;
  entityId?: string | null;
  data?: Prisma.InputJsonValue;
  ip?: string | null;
};

/** Append an audit record. Pass `tx` to make it atomic with the mutation. */
export async function audit(entry: AuditEntry, tx?: Tx) {
  const client = tx ?? db;
  await client.auditLog.create({
    data: {
      actor: entry.actor,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId ?? null,
      data: entry.data,
      ip: entry.ip ?? null,
    },
  });
}

import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppLogger } from '../logging/logger.service';
import { Clock } from '../clock';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../modules/audit/audit.service';
import { CryptoService, parseEnvelope } from './crypto.service';

/**
 * One encrypted column. Adding an encrypted column to the schema means adding
 * it here, and the test that walks this list fails if a column named `*Enc`
 * in the Prisma schema is missing from it.
 */
export interface EncryptedColumn {
  readonly model: 'parkIntegrationCredential' | 'payoutMethod' | 'adminUser';
  readonly column: 'apiKeyEnc' | 'providerTokenEnc' | 'mfaSecretEnc';
  readonly nullable: boolean;
}

export const ENCRYPTED_COLUMNS: readonly EncryptedColumn[] = [
  { model: 'parkIntegrationCredential', column: 'apiKeyEnc', nullable: false },
  { model: 'payoutMethod', column: 'providerTokenEnc', nullable: false },
  { model: 'adminUser', column: 'mfaSecretEnc', nullable: true },
];

export interface TargetCounts {
  scanned: number;
  current: number;
  reencrypted: number;
  skipped: number;
  failed: number;
  /** Rows per key id before the run; `unknown` = a key this process does not hold. */
  byKeyId: Record<string, number>;
}

export interface RotationReport {
  runId: string | null;
  activeKeyId: string;
  dryRun: boolean;
  status: 'COMPLETED' | 'COMPLETED_WITH_FAILURES';
  targets: Record<string, TargetCounts>;
}

export interface RotationOptions {
  readonly dryRun: boolean;
  readonly batchSize?: number;
  readonly startedByAdminId?: string;
}

/**
 * Re-encrypts every ciphertext column under the active key.
 *
 * Properties an operator can rely on:
 *
 *  - **Idempotent.** A row already under the active key is counted and left
 *    alone, so running the job twice, or after a crash, changes nothing twice.
 *  - **Resumable.** Rows are read in id order in batches; a crash mid-run loses
 *    nothing — the next run skips what was done.
 *  - **Concurrency-safe.** Each update is conditional on the ciphertext being
 *    the one that was read (`updateMany` with the old value in the `where`); a
 *    row rewritten by a request between read and write is skipped, not
 *    clobbered, and counted as skipped.
 *  - **Dry-run.** Counts rows per key id and decrypts each one to prove the
 *    key ring can read it, writing nothing.
 *  - **Failure-tolerant.** One undecryptable row (a key not in the ring, a
 *    tampered envelope) is counted as failed and the run continues; the run
 *    record and the audit log carry the counts.
 *  - **Never logs plaintext.** Only ids, key ids and counts reach the log.
 */
@Injectable()
export class KeyRotationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly logger: AppLogger,
  ) {}

  get activeKeyId(): string {
    return this.crypto.activeKeyId;
  }

  /** Rows per key id per column, without touching anything. */
  async inventory(): Promise<Record<string, Record<string, number>>> {
    const result: Record<string, Record<string, number>> = {};
    for (const target of ENCRYPTED_COLUMNS) {
      const counts: Record<string, number> = {};
      for await (const row of this.rows(target, 500)) {
        const keyId = this.keyIdOrUnknown(row.value);
        counts[keyId] = (counts[keyId] ?? 0) + 1;
      }
      result[`${target.model}.${target.column}`] = counts;
    }
    return result;
  }

  async run(options: RotationOptions): Promise<RotationReport> {
    const batchSize = options.batchSize ?? 200;
    const runRow = options.dryRun
      ? null
      : await this.prisma.encryptionKeyRotation.create({
          data: {
            activeKeyId: this.crypto.activeKeyId,
            dryRun: false,
            startedByAdminId: options.startedByAdminId ?? null,
          },
        });

    const targets: Record<string, TargetCounts> = {};
    let anyFailed = false;

    for (const target of ENCRYPTED_COLUMNS) {
      const counts: TargetCounts = {
        scanned: 0,
        current: 0,
        reencrypted: 0,
        skipped: 0,
        failed: 0,
        byKeyId: {},
      };
      targets[`${target.model}.${target.column}`] = counts;

      for await (const row of this.rows(target, batchSize)) {
        counts.scanned += 1;
        const keyId = this.keyIdOrUnknown(row.value);
        counts.byKeyId[keyId] = (counts.byKeyId[keyId] ?? 0) + 1;

        if (keyId === this.crypto.activeKeyId) {
          counts.current += 1;
          continue;
        }

        let rewrapped: string;
        try {
          // Proves the ring can read the row even in a dry run; the plaintext
          // never leaves this expression.
          rewrapped = this.crypto.reencrypt(row.value);
        } catch (error) {
          counts.failed += 1;
          anyFailed = true;
          this.logger.fail('Key rotation: row cannot be re-encrypted', error, {
            model: target.model,
            column: target.column,
            id: row.id,
            keyId,
          });
          continue;
        }

        if (options.dryRun) {
          counts.reencrypted += 1;
          continue;
        }

        const updated = await this.conditionalUpdate(target, row.id, row.value, rewrapped);
        if (updated) counts.reencrypted += 1;
        else counts.skipped += 1;
      }

      this.logger.info('Key rotation: target done', {
        dryRun: options.dryRun,
        model: target.model,
        column: target.column,
        ...counts,
      });
    }

    const status = anyFailed ? 'COMPLETED_WITH_FAILURES' : 'COMPLETED';
    if (runRow) {
      await this.prisma.encryptionKeyRotation.update({
        where: { id: runRow.id },
        data: {
          status,
          finishedAt: this.clock.now(),
          counts: targets as unknown as Prisma.InputJsonObject,
          lastError: anyFailed ? 'one or more rows could not be re-encrypted; see logs' : null,
        },
      });
    }
    await this.audit.record({
      action: options.dryRun ? 'security.key_rotation_dry_run' : 'security.key_rotation',
      subjectType: 'encryption_key',
      subjectId: this.crypto.activeKeyId,
      actorType: options.startedByAdminId ? 'ADMIN' : 'SYSTEM',
      actorId: options.startedByAdminId,
      after: { status, targets } as unknown as Prisma.InputJsonObject,
    });

    return {
      runId: runRow?.id ?? null,
      activeKeyId: this.crypto.activeKeyId,
      dryRun: options.dryRun,
      status,
      targets,
    };
  }

  async runs(limit = 20) {
    const rows = await this.prisma.encryptionKeyRotation.findMany({
      orderBy: { startedAt: 'desc' },
      take: limit,
    });
    return rows.map((row) => ({
      id: row.id,
      activeKeyId: row.activeKeyId,
      dryRun: row.dryRun,
      status: row.status,
      startedAt: row.startedAt.toISOString(),
      finishedAt: row.finishedAt?.toISOString() ?? null,
      startedByAdminId: row.startedByAdminId,
      counts: row.counts,
      lastError: row.lastError,
    }));
  }

  // ---------------------------------------------------------------- private

  private keyIdOrUnknown(envelope: string): string {
    try {
      return parseEnvelope(envelope).keyId;
    } catch {
      return 'malformed';
    }
  }

  /** Batches by id, ascending, so a run is resumable and bounded in memory. */
  private async *rows(
    target: EncryptedColumn,
    batchSize: number,
  ): AsyncGenerator<{ id: string; value: string }> {
    let cursor: string | null = null;
    for (;;) {
      const batch: Array<{ id: string; value: string | null }> = await this.selectBatch(
        target,
        cursor,
        batchSize,
      );
      if (batch.length === 0) return;
      for (const row of batch) {
        if (row.value === null) continue;
        yield { id: row.id, value: row.value };
      }
      cursor = batch[batch.length - 1]!.id;
      if (batch.length < batchSize) return;
    }
  }

  private async selectBatch(
    target: EncryptedColumn,
    cursor: string | null,
    take: number,
  ): Promise<Array<{ id: string; value: string | null }>> {
    const where = cursor ? { id: { gt: cursor } } : {};
    const args = {
      where,
      orderBy: { id: 'asc' as const },
      take,
      select: { id: true, [target.column]: true },
    };
    let rows: Array<Record<string, unknown>>;
    switch (target.model) {
      case 'parkIntegrationCredential':
        rows = await this.prisma.parkIntegrationCredential.findMany(args);
        break;
      case 'payoutMethod':
        rows = await this.prisma.payoutMethod.findMany(args);
        break;
      case 'adminUser':
        rows = await this.prisma.adminUser.findMany(args);
        break;
    }
    return rows.map((row) => ({
      id: String(row.id),
      value: (row[target.column] as string | null | undefined) ?? null,
    }));
  }

  /** Writes only if the ciphertext is still the one that was read. */
  private async conditionalUpdate(
    target: EncryptedColumn,
    id: string,
    expected: string,
    next: string,
  ): Promise<boolean> {
    const where = { id, [target.column]: expected };
    const data = { [target.column]: next };
    let result: { count: number };
    switch (target.model) {
      case 'parkIntegrationCredential':
        result = await this.prisma.parkIntegrationCredential.updateMany({ where, data });
        break;
      case 'payoutMethod':
        result = await this.prisma.payoutMethod.updateMany({ where, data });
        break;
      case 'adminUser':
        result = await this.prisma.adminUser.updateMany({ where, data });
        break;
    }
    return result.count === 1;
  }
}

import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  CreateParkDto,
  ImportRosterDto,
  SetParkCredentialDto,
  UpdateMembershipDto,
  UpdateParkDto,
  normalisePhone,
} from '@cashout/contracts';
import { AppError } from '../../common/app-error';
import { Clock } from '../../common/clock';
import { CryptoService } from '../../common/crypto/crypto.service';
import { AppLogger } from '../../common/logging/logger.service';
import { PrismaService, isUniqueViolation } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { YandexFleetPort } from '../yandex/yandex.port';

export interface RosterImportResult {
  readonly importId: string;
  readonly total: number;
  readonly created: number;
  readonly updated: number;
  readonly skipped: number;
  readonly errors: Array<{ row: number; reason: string }>;
}

/**
 * Operational tooling for parks and their rosters.
 *
 * Two ways a roster gets filled, both leading to the same rows:
 *  - an operator uploads the park's driver list (phone + contractor profile
 *    id), which is the way that needs nothing from Yandex;
 *  - a synchronisation pass reads the park's profiles through the Fleet API
 *    and upserts them, which needs the park's own credential.
 *
 * Neither path ever detaches a driver from a row it already claimed, and
 * neither can change which phone a claimed row belongs to: those are the two
 * mistakes that would pay one driver another driver's balance.
 */
@Injectable()
export class ParksAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly yandex: YandexFleetPort,
    private readonly logger: AppLogger,
  ) {}

  async list() {
    const parks = await this.prisma.park.findMany({
      include: {
        credential: { select: { clientId: true, apiKeyHint: true, lastVerifiedAt: true } },
        _count: { select: { memberships: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    return parks.map((park) => ({
      id: park.id,
      code: park.code,
      name: park.name,
      yandexParkId: park.yandexParkId,
      currency: park.currency,
      status: park.status,
      suspendedReason: park.suspendedReason,
      memberCount: park._count.memberships,
      credential: park.credential
        ? {
            clientId: park.credential.clientId,
            apiKeyHint: park.credential.apiKeyHint,
            lastVerifiedAt: park.credential.lastVerifiedAt?.toISOString() ?? null,
          }
        : null,
      createdAt: park.createdAt.toISOString(),
    }));
  }

  async detail(parkId: string) {
    const park = await this.prisma.park.findUnique({
      where: { id: parkId },
      include: {
        credential: true,
        rosterImports: { orderBy: { createdAt: 'desc' }, take: 10 },
        _count: { select: { memberships: true } },
      },
    });
    if (!park) throw AppError.notFound('Park');

    const [eligible, attached] = await Promise.all([
      this.prisma.driverParkMembership.count({
        where: { parkId, status: 'ACTIVE', eligibility: 'ELIGIBLE' },
      }),
      this.prisma.driverParkMembership.count({ where: { parkId, driverId: { not: null } } }),
    ]);

    return {
      id: park.id,
      code: park.code,
      name: park.name,
      yandexParkId: park.yandexParkId,
      currency: park.currency,
      status: park.status,
      suspendedReason: park.suspendedReason,
      createdAt: park.createdAt.toISOString(),
      counts: { members: park._count.memberships, eligible, attached },
      credential: park.credential
        ? {
            clientId: park.credential.clientId,
            apiKeyHint: park.credential.apiKeyHint,
            lastVerifiedAt: park.credential.lastVerifiedAt?.toISOString() ?? null,
            lastError: park.credential.lastError,
            updatedAt: park.credential.updatedAt.toISOString(),
          }
        : null,
      imports: park.rosterImports.map((row) => ({
        id: row.id,
        source: row.source,
        totalRows: row.totalRows,
        created: row.createdCount,
        updated: row.updatedCount,
        skipped: row.skippedCount,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }

  async create(dto: CreateParkDto, adminId: string) {
    try {
      const park = await this.prisma.park.create({
        data: {
          code: dto.code,
          name: dto.name,
          yandexParkId: dto.yandexParkId,
          currency: dto.currency,
          createdByAdminId: adminId,
        },
      });
      await this.audit.record({
        action: 'park.created',
        subjectType: 'park',
        subjectId: park.id,
        actorType: 'ADMIN',
        actorId: adminId,
        after: { code: park.code, yandexParkId: park.yandexParkId },
      });
      return park;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppError(
          'VALIDATION_FAILED',
          'A park with that code or Yandex id already exists',
        );
      }
      throw error;
    }
  }

  async update(parkId: string, dto: UpdateParkDto, adminId: string) {
    const before = await this.prisma.park.findUnique({ where: { id: parkId } });
    if (!before) throw AppError.notFound('Park');
    const park = await this.prisma.park.update({
      where: { id: parkId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.suspendedReason !== undefined ? { suspendedReason: dto.suspendedReason } : {}),
      },
    });
    await this.audit.record({
      action: 'park.updated',
      subjectType: 'park',
      subjectId: parkId,
      actorType: 'ADMIN',
      actorId: adminId,
      before: { name: before.name, status: before.status },
      after: { name: park.name, status: park.status },
    });
    return park;
  }

  /** Stores the key encrypted; the response never carries it back. */
  async setCredential(parkId: string, dto: SetParkCredentialDto, adminId: string) {
    const park = await this.prisma.park.findUnique({ where: { id: parkId } });
    if (!park) throw AppError.notFound('Park');

    await this.prisma.parkIntegrationCredential.upsert({
      where: { parkId },
      create: {
        parkId,
        clientId: dto.clientId,
        apiKeyEnc: this.crypto.encrypt(dto.apiKey),
        apiKeyHint: dto.apiKey.slice(-4),
        updatedByAdminId: adminId,
      },
      update: {
        clientId: dto.clientId,
        apiKeyEnc: this.crypto.encrypt(dto.apiKey),
        apiKeyHint: dto.apiKey.slice(-4),
        lastVerifiedAt: null,
        lastError: null,
        updatedByAdminId: adminId,
      },
    });
    await this.audit.record({
      action: 'park.credential_set',
      subjectType: 'park',
      subjectId: parkId,
      actorType: 'ADMIN',
      actorId: adminId,
      after: { clientId: dto.clientId, apiKeyHint: dto.apiKey.slice(-4) },
    });
  }

  /** Calls the Fleet API once with the park's key and records the answer. */
  async verifyCredential(parkId: string): Promise<{ ok: boolean; error: string | null }> {
    const park = await this.prisma.park.findUnique({
      where: { id: parkId },
      include: { credential: true },
    });
    if (!park) throw AppError.notFound('Park');
    if (!park.credential) return { ok: false, error: 'no credential configured' };

    let ok = false;
    let error: string | null = null;
    try {
      ok = await this.yandex.ping(park.yandexParkId);
      if (!ok) error = 'the Fleet API did not answer';
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }
    await this.prisma.parkIntegrationCredential.update({
      where: { parkId },
      data: ok
        ? { lastVerifiedAt: this.clock.now(), lastError: null }
        : { lastError: error?.slice(0, 500) ?? 'unknown' },
    });
    return { ok, error };
  }

  async listMemberships(
    parkId: string,
    query: { limit: number; cursor?: string; search?: string },
  ) {
    const rows = await this.prisma.driverParkMembership.findMany({
      where: {
        parkId,
        ...(query.search
          ? {
              OR: [
                { phone: { contains: query.search } },
                { externalProfileId: { contains: query.search } },
                { firstName: { contains: query.search, mode: 'insensitive' } },
                { lastName: { contains: query.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      include: {
        driver: { select: { id: true, verificationStatus: true, activeMembershipId: true } },
      },
      orderBy: { createdAt: 'asc' },
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const page = rows.slice(0, query.limit);
    return {
      items: page.map((row) => ({
        id: row.id,
        phone: row.phone,
        externalProfileId: row.externalProfileId,
        name: [row.firstName, row.lastName].filter(Boolean).join(' ') || null,
        status: row.status,
        eligibility: row.eligibility,
        eligibilityReason: row.eligibilityReason,
        source: row.source,
        driverId: row.driverId,
        driverStatus: row.driver?.verificationStatus ?? null,
        isActiveForDriver: row.driver?.activeMembershipId === row.id,
        lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
      })),
      nextCursor: rows.length > query.limit ? (page[page.length - 1]?.id ?? null) : null,
    };
  }

  /**
   * Upserts roster rows. Keyed on `(park, externalProfileId)`; a row that would
   * move a claimed profile to another phone is refused rather than applied.
   */
  async importRoster(
    parkId: string,
    dto: ImportRosterDto,
    adminId: string | null,
    source: 'ROSTER_IMPORT' | 'YANDEX_SYNC' = 'ROSTER_IMPORT',
  ): Promise<RosterImportResult> {
    const park = await this.prisma.park.findUnique({ where: { id: parkId } });
    if (!park) throw AppError.notFound('Park');

    let created = 0;
    let updated = 0;
    let skipped = 0;
    const errors: Array<{ row: number; reason: string }> = [];

    for (const [index, row] of dto.rows.entries()) {
      const phone = normalisePhone(row.phone);
      if (!phone) {
        skipped += 1;
        errors.push({ row: index + 1, reason: `unparseable phone "${row.phone}"` });
        continue;
      }
      const outcome = await this.upsertRow(parkId, {
        phone,
        externalProfileId: row.externalProfileId.trim(),
        firstName: row.firstName?.trim() || null,
        lastName: row.lastName?.trim() || null,
        source,
      });
      if (outcome === 'created') created += 1;
      else if (outcome === 'updated') updated += 1;
      else {
        skipped += 1;
        errors.push({ row: index + 1, reason: outcome });
      }
    }

    const record = await this.prisma.rosterImport.create({
      data: {
        parkId,
        source,
        totalRows: dto.rows.length,
        createdCount: created,
        updatedCount: updated,
        skippedCount: skipped,
        errors: errors.length > 0 ? (errors as unknown as Prisma.InputJsonValue) : undefined,
        createdByAdminId: adminId,
      },
    });
    await this.audit.record({
      action: source === 'YANDEX_SYNC' ? 'park.roster_synced' : 'park.roster_imported',
      subjectType: 'park',
      subjectId: parkId,
      actorType: adminId ? 'ADMIN' : 'SYSTEM',
      actorId: adminId ?? undefined,
      after: { importId: record.id, total: dto.rows.length, created, updated, skipped },
    });

    return { importId: record.id, total: dto.rows.length, created, updated, skipped, errors };
  }

  /**
   * Reads the park's profiles through the Fleet API and folds them into the
   * roster. Needs the park's own credential; classified LIVE-UNVERIFIED until
   * it has run against a real park.
   */
  async syncFromYandex(parkId: string, adminId: string | null): Promise<RosterImportResult> {
    const park = await this.prisma.park.findUnique({ where: { id: parkId } });
    if (!park) throw AppError.notFound('Park');

    const rows: ImportRosterDto['rows'] = [];
    const pageSize = 100;
    for (let offset = 0; offset < 10_000; offset += pageSize) {
      let page;
      try {
        page = await this.yandex.listProfiles(park.yandexParkId, { limit: pageSize, offset });
      } catch (error) {
        this.logger.fail('Roster sync: Fleet API call failed', error, { parkId });
        throw new AppError('YANDEX_UNAVAILABLE', 'The fleet system is not responding');
      }
      for (const profile of page.items) {
        const phone = profile.phones[0];
        if (!phone || !profile.id) continue;
        rows.push({
          phone,
          externalProfileId: profile.id,
          firstName: profile.firstName ?? undefined,
          lastName: profile.lastName ?? undefined,
        });
      }
      if (page.items.length < pageSize) break;
    }

    if (rows.length === 0) {
      return { importId: '', total: 0, created: 0, updated: 0, skipped: 0, errors: [] };
    }
    return this.importRoster(parkId, { rows }, adminId, 'YANDEX_SYNC');
  }

  async updateMembership(membershipId: string, dto: UpdateMembershipDto, adminId: string) {
    const before = await this.prisma.driverParkMembership.findUnique({
      where: { id: membershipId },
    });
    if (!before) throw AppError.notFound('Membership');

    const after = await this.prisma.driverParkMembership.update({
      where: { id: membershipId },
      data: {
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.eligibility !== undefined
          ? { eligibility: dto.eligibility, eligibilityReason: dto.reason }
          : {}),
      },
    });

    // A driver whose active membership just became unusable loses it now, not
    // at their next sign-in.
    if (before.driverId) {
      const driver = await this.prisma.driver.findUnique({ where: { id: before.driverId } });
      const unusable = after.status !== 'ACTIVE' || after.eligibility !== 'ELIGIBLE';
      if (driver?.activeMembershipId === membershipId && unusable) {
        await this.prisma.$transaction([
          this.prisma.driver.update({
            where: { id: driver.id },
            data: {
              activeMembershipId: null,
              verificationStatus: after.eligibility === 'PENDING_REVIEW' ? 'PENDING' : 'UNLINKED',
            },
          }),
          this.prisma.balanceSnapshot.deleteMany({ where: { driverId: driver.id } }),
        ]);
      }
    }

    await this.audit.record({
      action: 'membership.updated',
      subjectType: 'membership',
      subjectId: membershipId,
      actorType: 'ADMIN',
      actorId: adminId,
      reason: dto.reason,
      before: { status: before.status, eligibility: before.eligibility },
      after: { status: after.status, eligibility: after.eligibility },
    });
    return after;
  }

  private async upsertRow(
    parkId: string,
    row: {
      phone: string;
      externalProfileId: string;
      firstName: string | null;
      lastName: string | null;
      source: 'ROSTER_IMPORT' | 'YANDEX_SYNC';
    },
  ): Promise<'created' | 'updated' | string> {
    const existing = await this.prisma.driverParkMembership.findUnique({
      where: { parkId_externalProfileId: { parkId, externalProfileId: row.externalProfileId } },
    });

    if (existing) {
      if (existing.driverId && existing.phone !== row.phone) {
        return `profile ${row.externalProfileId} is claimed by ${existing.phone}; refusing to move it to ${row.phone}`;
      }
      try {
        await this.prisma.driverParkMembership.update({
          where: { id: existing.id },
          data: {
            phone: row.phone,
            firstName: row.firstName ?? existing.firstName,
            lastName: row.lastName ?? existing.lastName,
            status: existing.status === 'REMOVED' ? 'ACTIVE' : existing.status,
            lastSyncedAt: row.source === 'YANDEX_SYNC' ? this.clock.now() : existing.lastSyncedAt,
          },
        });
        return 'updated';
      } catch (error) {
        if (isUniqueViolation(error)) {
          return `phone ${row.phone} already holds another profile in this park`;
        }
        throw error;
      }
    }

    // A driver who already signed in with this phone is attached at once.
    const user = await this.prisma.user.findUnique({
      where: { phone: row.phone },
      include: { driver: { select: { id: true } } },
    });

    try {
      await this.prisma.driverParkMembership.create({
        data: {
          parkId,
          phone: row.phone,
          externalProfileId: row.externalProfileId,
          firstName: row.firstName,
          lastName: row.lastName,
          source: row.source,
          driverId: user?.driver?.id ?? null,
          lastSyncedAt: row.source === 'YANDEX_SYNC' ? this.clock.now() : null,
        },
      });
      return 'created';
    } catch (error) {
      if (isUniqueViolation(error)) {
        return `phone ${row.phone} already holds another profile in this park`;
      }
      throw error;
    }
  }
}

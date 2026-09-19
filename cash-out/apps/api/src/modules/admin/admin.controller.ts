import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import {
  adminWithdrawalFilterSchema,
  paginationSchema,
  permissionsFor,
  resolveManualReviewSchema,
  type AdminRole,
  type AdminWithdrawalFilter,
  type ResolveManualReviewDto,
} from '@cashout/contracts';
import { ZodValidationPipe, zodBody } from '../../common/zod.pipe';
import { Public } from '../auth/auth.guard';
import { ReconciliationService } from '../reconciliation/reconciliation.service';
import { AdminAuthService } from './admin-auth.service';
import { AdminGuard, AdminRequest, RequirePermission } from './admin.guard';
import { AdminService } from './admin.service';
import { CurrentAdmin } from './admin.decorators';
import { PricingService } from './pricing.service';
import { IntegrationHealthService } from './integration-health.service';

const signInSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(200),
  totpCode: z.string().regex(/^\d{6}$/).optional(),
});

const driverQuerySchema = paginationSchema.extend({ search: z.string().max(120).optional() });
const auditQuerySchema = paginationSchema.extend({ subjectId: z.string().uuid().optional() });
const blockSchema = z.object({ blocked: z.boolean(), reason: z.string().min(5).max(500) });
const resolveMismatchSchema = z.object({ note: z.string().min(5).max(1000) });

/** Sign-in is the only admin route reachable without an admin session. */
@Controller('v1/admin/auth')
export class AdminAuthController {
  constructor(private readonly auth: AdminAuthService) {}

  @Public()
  @Post('sign-in')
  @HttpCode(200)
  async signIn(@Body(zodBody(signInSchema)) dto: z.infer<typeof signInSchema>) {
    const result = await this.auth.signIn(dto.email, dto.password, dto.totpCode);
    return {
      token: result.token,
      expiresIn: result.expiresIn,
      admin: {
        ...result.admin,
        permissions: permissionsFor(result.admin.role as AdminRole),
      },
    };
  }
}

@Controller('v1/admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly auth: AdminAuthService,
    private readonly reconciliation: ReconciliationService,
    private readonly pricing: PricingService,
    private readonly integrations: IntegrationHealthService,
  ) {}

  @Get('me')
  @RequirePermission('dashboard:read')
  async me(@CurrentAdmin() admin: AdminRequest['admin']) {
    return { ...admin, permissions: permissionsFor(admin!.role as AdminRole) };
  }

  @Post('auth/sign-out')
  @RequirePermission('dashboard:read')
  @HttpCode(204)
  async signOut(@CurrentAdmin() admin: AdminRequest['admin']) {
    await this.auth.signOut(admin!.sessionId);
  }

  @Post('auth/mfa/begin')
  @RequirePermission('dashboard:read')
  async beginMfa(@CurrentAdmin() admin: AdminRequest['admin']) {
    return this.auth.beginMfaEnrolment(admin!.id);
  }

  @Post('auth/mfa/confirm')
  @RequirePermission('dashboard:read')
  @HttpCode(204)
  async confirmMfa(
    @CurrentAdmin() admin: AdminRequest['admin'],
    @Body(zodBody(z.object({ code: z.string().regex(/^\d{6}$/) }))) dto: { code: string },
  ) {
    await this.auth.confirmMfaEnrolment(admin!.id, dto.code);
  }

  // ------------------------------------------------------------- dashboard

  @Get('dashboard')
  @RequirePermission('dashboard:read')
  async dashboard(
    @Query(new ZodValidationPipe(z.object({ window: z.enum(['24h', '7d', '30d']).default('24h') })))
    query: { window: '24h' | '7d' | '30d' },
  ) {
    return this.admin.dashboard(query.window);
  }

  // ------------------------------------------------------------- withdrawals

  @Get('withdrawals')
  @RequirePermission('withdrawals:read')
  async withdrawals(
    @Query(new ZodValidationPipe(adminWithdrawalFilterSchema)) filter: AdminWithdrawalFilter,
  ) {
    return this.admin.listWithdrawals(filter);
  }

  @Get('withdrawals/:id')
  @RequirePermission('withdrawals:read')
  async withdrawal(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.withdrawalDetail(id);
  }

  @Post('withdrawals/:id/resolve')
  @RequirePermission('withdrawals:resolve')
  @HttpCode(204)
  async resolve(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentAdmin() admin: AdminRequest['admin'],
    @Body(zodBody(resolveManualReviewSchema)) dto: ResolveManualReviewDto,
  ) {
    await this.admin.resolveManualReview(id, admin!.id, dto);
  }

  // ----------------------------------------------------------------- drivers

  @Get('drivers')
  @RequirePermission('drivers:read')
  async drivers(
    @Query(new ZodValidationPipe(driverQuerySchema))
    query: { limit: number; cursor?: string; search?: string },
  ) {
    return this.admin.listDrivers(query);
  }

  @Post('drivers/:id/block')
  @RequirePermission('drivers:write')
  @HttpCode(204)
  async block(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentAdmin() admin: AdminRequest['admin'],
    @Body(zodBody(blockSchema)) dto: { blocked: boolean; reason: string },
  ) {
    await this.admin.setDriverBlocked(id, dto.blocked, admin!.id, dto.reason);
  }

  // ---------------------------------------------------------- reconciliation

  @Get('reconciliation/mismatches')
  @RequirePermission('reconciliation:read')
  async mismatches() {
    const rows = await this.reconciliation.openMismatches();
    return {
      items: rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        runKind: row.run.kind,
        withdrawalId: row.withdrawalId,
        expected: row.expected,
        actual: row.actual,
        detail: row.detail,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }

  @Post('reconciliation/run')
  @RequirePermission('reconciliation:run')
  async runReconciliation(
    @Query(new ZodValidationPipe(z.object({ kind: z.enum(['LEDGER', 'YANDEX', 'PROVIDER']) })))
    query: { kind: 'LEDGER' | 'YANDEX' | 'PROVIDER' },
    @CurrentAdmin() admin: AdminRequest['admin'],
  ) {
    switch (query.kind) {
      case 'LEDGER':
        return this.reconciliation.runLedger(`ADMIN:${admin!.id}`);
      case 'YANDEX':
        return this.reconciliation.runYandex(`ADMIN:${admin!.id}`);
      case 'PROVIDER':
      default:
        return this.reconciliation.runProvider(`ADMIN:${admin!.id}`);
    }
  }

  @Post('reconciliation/mismatches/:id/resolve')
  @RequirePermission('reconciliation:run')
  @HttpCode(204)
  async resolveMismatch(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(resolveMismatchSchema)) dto: { note: string },
  ) {
    await this.reconciliation.resolveMismatch(id, dto.note);
  }

  @Get('stuck')
  @RequirePermission('withdrawals:read')
  async stuck() {
    const rows = await this.reconciliation.stuck();
    return {
      items: rows.map((row) => ({
        id: row.id,
        reference: row.reference,
        state: row.state,
        gross: row.grossMinor.toString(),
        currency: row.currency,
        updatedAt: row.updatedAt.toISOString(),
      })),
    };
  }

  // ----------------------------------------------------------- fees & limits

  @Get('fees')
  @RequirePermission('fees:read')
  async fees() {
    return { items: await this.pricing.listFeeSchedules() };
  }

  @Post('fees')
  @RequirePermission('fees:write')
  async createFee(
    @CurrentAdmin() admin: AdminRequest['admin'],
    @Body(zodBody(PricingService.feeScheduleSchema)) dto: z.infer<typeof PricingService.feeScheduleSchema>,
  ) {
    return this.pricing.replaceFeeSchedule(dto, admin!.id);
  }

  @Get('limits')
  @RequirePermission('limits:read')
  async limits() {
    return { items: await this.pricing.listLimitPolicies() };
  }

  @Post('limits')
  @RequirePermission('limits:write')
  async createLimit(
    @CurrentAdmin() admin: AdminRequest['admin'],
    @Body(zodBody(PricingService.limitPolicySchema)) dto: z.infer<typeof PricingService.limitPolicySchema>,
  ) {
    return this.pricing.replaceLimitPolicy(dto, admin!.id);
  }

  // ------------------------------------------------------------ integrations

  @Get('integrations')
  @RequirePermission('integrations:read')
  async integrationStatus() {
    return { items: await this.integrations.snapshot() };
  }

  // ------------------------------------------------------------------- audit

  @Get('audit')
  @RequirePermission('audit:read')
  async audit(
    @Query(new ZodValidationPipe(auditQuerySchema))
    query: { limit: number; cursor?: string; subjectId?: string },
  ) {
    return this.admin.auditLog(query);
  }
}

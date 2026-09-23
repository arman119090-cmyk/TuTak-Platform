import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  BranchStaffRole,
  PartnerBranchState,
  PartnerStaffInvitationStatus,
  Prisma,
  RoleName,
} from '@prisma/client';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { SMS_PROVIDER, SmsProvider } from '../../infrastructure/sms/sms-provider.interface';
import { PartnerBranchStaffService } from './partner-branch-staff.service';
import { PartnerEmployeeService } from './partner-employee.service';

/**
 * The two roles an invitation may grant.
 *
 * Not a preference — the boundary. `PARTNER_OWNER` is who the business
 * belongs to and is set when the partner is created or handed over, not by
 * somebody sending a text message; the platform roles are not a partner's to
 * give at all. Anything outside this list is refused whatever is posted.
 */
const INVITABLE_ROLES: RoleName[] = [RoleName.PARTNER_STAFF, RoleName.PARTNER_MANAGER];

/** How long an offer stands. Long enough to read a message, short enough that a forgotten one stops working. */
const INVITATION_TTL_MS = 7 * 24 * 60 * 60_000;

/**
 * How many refusals one invitation tolerates before it stops answering.
 *
 * The token is 256 random bits, so guessing it is not the threat this
 * number addresses; a leaked-then-changed link and somebody trying
 * variations of it is. Low enough to be a wall, high enough that a person
 * fat-fingering a code twice is not locked out of their own job.
 */
const MAX_ATTEMPTS = 10;

export type InvitationView = {
  id: string;
  partnerId: string;
  phone: string;
  role: RoleName;
  branchIds: string[];
  /** `PENDING` that is past its deadline reads as `EXPIRED` here and nowhere else. */
  status: PartnerStaffInvitationStatus | 'EXPIRED';
  expiresAt: string;
  createdAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
};

@Injectable()
export class PartnerStaffInvitationService {
  private readonly logger = new Logger(PartnerStaffInvitationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly branchStaff: PartnerBranchStaffService,
    private readonly employees: PartnerEmployeeService,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
  ) {}

  /** The only thing ever written down about a token. */
  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /**
   * Status as a reader should see it: a pending offer past its deadline is
   * expired, whatever the column says.
   *
   * The column deliberately stays `PENDING` — see the enum's own docblock.
   */
  private view(row: {
    id: string;
    partnerId: string;
    phone: string;
    role: RoleName;
    branchIds: string[];
    status: PartnerStaffInvitationStatus;
    expiresAt: Date;
    createdAt: Date;
    acceptedAt: Date | null;
    revokedAt: Date | null;
  }): InvitationView {
    const expired =
      row.status === PartnerStaffInvitationStatus.PENDING && row.expiresAt.getTime() <= Date.now();
    return {
      id: row.id,
      partnerId: row.partnerId,
      phone: row.phone,
      role: row.role,
      branchIds: row.branchIds,
      status: expired ? 'EXPIRED' : row.status,
      expiresAt: row.expiresAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      acceptedAt: row.acceptedAt?.toISOString() ?? null,
      revokedAt: row.revokedAt?.toISOString() ?? null,
    };
  }

  /**
   * Offer somebody a job.
   *
   * The token is generated here, sent to the invited phone, and never
   * returned to the caller. That is the point: an owner who could read it
   * could accept on the invitee's behalf, and the whole arrangement would be
   * the owner creating accounts rather than a person joining.
   *
   * Returns what the owner's screen is entitled to know — that an offer is
   * out, to which number, until when.
   */
  async invite(params: {
    partnerId: string;
    phone: string;
    role: RoleName;
    branchIds: string[];
    createdByUserId: string;
  }): Promise<InvitationView> {
    if (!INVITABLE_ROLES.includes(params.role)) {
      throw new ForbiddenException('An invitation can only grant a staff or manager role');
    }
    await this.assertBranchesBelongHere(params.partnerId, params.branchIds);

    // Somebody who already works here is managed from the roster, not by a
    // second invitation: accepting one would be a no-op at best and a silent
    // role change at worst.
    const existingRole = await this.prisma.userRole.findFirst({
      where: { partnerId: params.partnerId, user: { phone: params.phone } },
    });
    if (existingRole) {
      throw new ConflictException('This person already has a role at your organisation');
    }

    const token = randomBytes(32).toString('base64url');
    try {
      const created = await this.prisma.partnerStaffInvitation.create({
        data: {
          partnerId: params.partnerId,
          phone: params.phone,
          role: params.role,
          branchIds: params.branchIds,
          tokenHash: this.hash(token),
          expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
          createdByUserId: params.createdByUserId,
        },
      });

      await this.deliver(params.phone, token);
      // The id, never the token. A log line is a place tokens leak from.
      this.logger.log(`Invitation ${created.id} sent for partner ${params.partnerId}`);
      return this.view(created);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException(
          'There is already an open invitation for this number. Revoke it first, or resend it.',
        );
      }
      throw err;
    }
  }

  /**
   * Send it again.
   *
   * Revoke-and-replace rather than re-deliver, because re-delivering the
   * same token means the token has been in two messages, and a person who
   * saw the first one keeps a working key after the owner "resent" the
   * invitation to a corrected number. The old token stops working the
   * moment this returns.
   */
  async resend(partnerId: string, invitationId: string, actorUserId: string): Promise<InvitationView> {
    const existing = await this.ownRow(partnerId, invitationId);
    if (existing.status !== PartnerStaffInvitationStatus.PENDING) {
      throw new ConflictException('Only an open invitation can be resent');
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.partnerStaffInvitation.update({
        where: { id: existing.id },
        data: {
          status: PartnerStaffInvitationStatus.REVOKED,
          revokedAt: new Date(),
          revokedByUserId: actorUserId,
        },
      });
      const token = randomBytes(32).toString('base64url');
      const replacement = await tx.partnerStaffInvitation.create({
        data: {
          partnerId: existing.partnerId,
          phone: existing.phone,
          role: existing.role,
          branchIds: existing.branchIds,
          tokenHash: this.hash(token),
          expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
          createdByUserId: actorUserId,
        },
      });
      await this.deliver(existing.phone, token);
      return this.view(replacement);
    });
  }

  /** Call it back. An accepted one cannot be revoked — what it granted is undone from the roster. */
  async revoke(partnerId: string, invitationId: string, actorUserId: string): Promise<InvitationView> {
    const existing = await this.ownRow(partnerId, invitationId);
    if (existing.status !== PartnerStaffInvitationStatus.PENDING) {
      throw new ConflictException(
        'This invitation is no longer open. Access already granted is removed from the staff list.',
      );
    }
    const revoked = await this.prisma.partnerStaffInvitation.update({
      where: { id: existing.id },
      data: {
        status: PartnerStaffInvitationStatus.REVOKED,
        revokedAt: new Date(),
        revokedByUserId: actorUserId,
      },
    });
    return this.view(revoked);
  }

  /** The owner's list. Newest first; tokens are not in it, because they are not anywhere. */
  async list(partnerId: string): Promise<InvitationView[]> {
    const rows = await this.prisma.partnerStaffInvitation.findMany({
      where: { partnerId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map((row) => this.view(row));
  }

  /**
   * Accept it, as the person whose phone it was sent to.
   *
   * `acceptor` is the authenticated session, and its phone must equal the
   * invitation's. That is what makes holding the token insufficient: the
   * token proves the message arrived at a number, and the session proves the
   * person controls that number — which the existing OTP login already
   * establishes, so nothing here re-invents it.
   *
   * Everything the acceptance grants happens in one transaction with the
   * status flip, and the flip is conditional on the row still being
   * `PENDING`. A revoke that commits first therefore wins, and a second
   * attempt with the same token finds nothing to accept: the offer is spent
   * exactly once.
   */
  async accept(params: {
    token: string;
    acceptorUserId: string;
    acceptorPhone: string;
  }): Promise<{ partnerId: string; role: RoleName; employeeCode: string; branchIds: string[] }> {
    const tokenHash = this.hash(params.token);
    const invitation = await this.prisma.partnerStaffInvitation.findUnique({ where: { tokenHash } });

    // One message for every way this can fail, so the endpoint cannot be
    // asked "does this token exist" by comparing answers.
    const refuse = () =>
      new BadRequestException('This invitation is not valid. Ask for a new one.');

    if (!invitation) throw refuse();
    if (invitation.attemptCount >= MAX_ATTEMPTS) throw refuse();
    if (invitation.status !== PartnerStaffInvitationStatus.PENDING) throw refuse();
    if (invitation.expiresAt.getTime() <= Date.now()) throw refuse();

    // The phone comparison is fixed-time for the same reason the token is
    // hashed: the answer must not be readable from how long it took.
    if (!equalsInConstantTime(invitation.phone, params.acceptorPhone)) {
      await this.countFailure(invitation.id);
      throw refuse();
    }

    const branchIds = await this.openBranchesAmong(invitation.partnerId, invitation.branchIds);

    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.partnerStaffInvitation.updateMany({
        where: { id: invitation.id, status: PartnerStaffInvitationStatus.PENDING },
        data: {
          status: PartnerStaffInvitationStatus.ACCEPTED,
          acceptedAt: new Date(),
          acceptedByUserId: params.acceptorUserId,
        },
      });
      // Lost to a revoke or to a second acceptance that got here first.
      if (claimed.count === 0) throw refuse();

      const role = await tx.role.findFirstOrThrow({ where: { name: invitation.role } });
      await tx.userRole.upsert({
        where: {
          userId_roleId_partnerId: {
            userId: params.acceptorUserId,
            roleId: role.id,
            partnerId: invitation.partnerId,
          },
        },
        update: {},
        create: {
          userId: params.acceptorUserId,
          roleId: role.id,
          partnerId: invitation.partnerId,
        },
      });

      const employeeCode = await this.employees.codeFor(
        invitation.partnerId,
        params.acceptorUserId,
        tx,
      );

      return { partnerId: invitation.partnerId, role: invitation.role, employeeCode, branchIds };
    }).then(async (granted) => {
      // The postings are made after the role exists, because `assign` refuses
      // somebody who has no role here — and that refusal is worth keeping.
      for (const branchId of granted.branchIds) {
        await this.branchStaff.assign(granted.partnerId, branchId, {
          userId: params.acceptorUserId,
          role:
            granted.role === RoleName.PARTNER_MANAGER
              ? BranchStaffRole.MANAGER
              : BranchStaffRole.STAFF,
          assignedByUserId: params.acceptorUserId,
        });
      }
      return granted;
    });
  }

  private async countFailure(invitationId: string): Promise<void> {
    await this.prisma.partnerStaffInvitation.update({
      where: { id: invitationId },
      data: { attemptCount: { increment: 1 } },
    });
  }

  private async ownRow(partnerId: string, invitationId: string) {
    const row = await this.prisma.partnerStaffInvitation.findFirst({
      where: { id: invitationId, partnerId },
    });
    if (!row) throw new NotFoundException('Invitation not found');
    return row;
  }

  private async assertBranchesBelongHere(partnerId: string, branchIds: string[]): Promise<void> {
    if (branchIds.length === 0) return;
    const open = await this.openBranchesAmong(partnerId, branchIds);
    if (open.length !== branchIds.length) {
      throw new BadRequestException(
        'One of those branches is not yours, or is no longer taking staff',
      );
    }
  }

  /**
   * Which of these branches are this partner's and still take staff.
   *
   * Re-read at acceptance rather than trusted from the offer: a branch may
   * have been archived in the week between, and posting somebody to a
   * location the business no longer trades at is a promise nobody can keep.
   */
  private async openBranchesAmong(partnerId: string, branchIds: string[]): Promise<string[]> {
    if (branchIds.length === 0) return [];
    const rows = await this.prisma.partnerBranch.findMany({
      where: {
        partnerId,
        id: { in: branchIds },
        state: { not: PartnerBranchState.ARCHIVED },
      },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  /**
   * Hand the token to the phone.
   *
   * Through the same port every other message goes through, so the local and
   * test environments print it to the console instead of sending anything —
   * which is the requirement, not a convenience.
   */
  private async deliver(phone: string, token: string): Promise<void> {
    await this.sms.send({
      to: phone,
      body: `TuTak: you have been invited to join a business. Code: ${token}`,
      templateParams: [token],
    });
  }
}

/**
 * Compares two strings without letting the time taken say how far they
 * matched. Length differences are unavoidable information, so they are
 * answered immediately rather than pretended away.
 */
function equalsInConstantTime(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

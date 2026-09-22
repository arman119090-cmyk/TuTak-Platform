import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import {
  PartnerBranchState,
  PartnerStaffInvitationStatus,
  PrismaClient,
  RoleName,
} from '@prisma/client';
import { createHash } from 'node:crypto';
import { PartnerStaffInvitationService } from '../src/modules/partners/partner-staff-invitation.service';
import {
  PartnerStaffInvitationAcceptController,
  PartnerStaffInvitationController,
} from '../src/modules/partners/partner-staff-invitation.controller';
import { PartnersService } from '../src/modules/partners/partners.service';
import { SMS_PROVIDER, SmsProvider } from '../src/infrastructure/sms/sms-provider.interface';
import { RequestUser } from '../src/modules/auth/types/request-user.type';
import { createPartner, createStaffUser } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * Inviting somebody to work at a partner — the route that hands out access
 * to a business's money.
 *
 * The properties tested here are the ones that make an invitation safe to
 * send over SMS at all: it expires, it works once, it can be called back, it
 * cannot be read out of the database, it cannot grant more than it says, and
 * it cannot be accepted by whoever happens to have the link.
 *
 * No real message is sent. The SMS port is the same one the rest of the
 * platform uses, and in this environment it resolves to the console
 * provider; these tests read the token out of the captured send rather than
 * out of any API response, because no API response ever contains it.
 */
describe('Partner staff invitations (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let invitations: PartnerStaffInvitationService;
  let controller: PartnerStaffInvitationController;
  let acceptController: PartnerStaffInvitationAcceptController;
  let partners: PartnersService;
  let sms: SmsProvider;
  let sent: { to: string; body: string }[];

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    invitations = harness.app.get(PartnerStaffInvitationService);
    controller = harness.app.get(PartnerStaffInvitationController);
    acceptController = harness.app.get(PartnerStaffInvitationAcceptController);
    partners = harness.app.get(PartnersService);
    sms = harness.app.get(SMS_PROVIDER);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
    sent = [];
    jest.spyOn(sms, 'send').mockImplementation((message) => {
      sent.push({ to: message.to, body: message.body });
      return Promise.resolve({ providerMessageId: 'test' });
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /** The token, as only the invited phone ever sees it. */
  const tokenFromMessage = () => {
    const body = sent.at(-1)?.body ?? '';
    return body.slice(body.lastIndexOf(' ') + 1);
  };

  const actor = (id: string, roles: RoleName[], partnerId: string, phone = '+37400000000'): RequestUser => ({
    id,
    phone,
    roles,
    permissions: [],
    partnerScopes: Object.fromEntries(roles.map((r) => [r, [partnerId]])),
    branchIds: [],
    allBranchPartnerIds: roles.includes(RoleName.PARTNER_OWNER) ? [partnerId] : [],
    mustChangePassword: false,
  });

  const ownerOf = async (partnerId: string) => {
    const user = await createStaffUser(prisma);
    await prisma.userRole.create({
      data: {
        userId: user.id,
        roleId: (await prisma.role.findFirstOrThrow({ where: { name: RoleName.PARTNER_OWNER } })).id,
        partnerId,
      },
    });
    return user;
  };

  const branchOf = (partnerId: string, name: string) =>
    prisma.partnerBranch.create({
      data: {
        partnerId,
        name,
        address: `${name} 1`,
        city: 'Yerevan',
        latitude: 40.18,
        longitude: 44.51,
      },
    });

  /** Somebody with an account and a phone, who does not work anywhere yet. */
  const stranger = (phone: string) =>
    prisma.user.create({
      data: {
        phone,
        passwordHash: 'test-not-a-real-hash',
        firstName: 'Invited',
        lastName: 'Person',
        isActive: true,
        isPhoneVerified: true,
      },
    });

  describe('what the token is and is not', () => {
    it('never puts the token in the answer the owner gets', async () => {
      const partner = await createPartner(prisma);
      const owner = await ownerOf(partner.id);

      const invitation = await controller.invite(
        actor(owner.id, [RoleName.PARTNER_OWNER], partner.id),
        partner.id,
        { phone: '+37491000001', role: RoleName.PARTNER_STAFF },
      );

      const token = tokenFromMessage();
      expect(token.length).toBeGreaterThan(20);
      expect(JSON.stringify(invitation)).not.toContain(token);
    });

    it('never writes the token down, only its hash', async () => {
      const partner = await createPartner(prisma);
      const owner = await ownerOf(partner.id);
      await controller.invite(
        actor(owner.id, [RoleName.PARTNER_OWNER], partner.id),
        partner.id,
        { phone: '+37491000001', role: RoleName.PARTNER_STAFF },
      );
      const token = tokenFromMessage();

      const row = await prisma.partnerStaffInvitation.findFirstOrThrow();
      expect(row.tokenHash).toBe(createHash('sha256').update(token).digest('hex'));
      expect(JSON.stringify(row)).not.toContain(token);
    });

    it('sends it to the invited number and nowhere else', async () => {
      const partner = await createPartner(prisma);
      const owner = await ownerOf(partner.id);

      await controller.invite(
        actor(owner.id, [RoleName.PARTNER_OWNER], partner.id),
        partner.id,
        { phone: '+37491000001', role: RoleName.PARTNER_STAFF },
      );

      expect(sent).toHaveLength(1);
      expect(sent[0]!.to).toBe('+37491000001');
    });
  });

  describe('who may send one, and what it may grant', () => {
    it('refuses a cashier trying to invite', async () => {
      const partner = await createPartner(prisma);
      const cashier = await createStaffUser(prisma);

      await expect(
        controller.invite(
          actor(cashier.id, [RoleName.PARTNER_STAFF], partner.id),
          partner.id,
          { phone: '+37491000001', role: RoleName.PARTNER_STAFF },
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('refuses another partner’s organisation', async () => {
      const mine = await createPartner(prisma, { displayName: 'Mine' });
      const theirs = await createPartner(prisma, { displayName: 'Theirs' });
      const owner = await ownerOf(mine.id);

      await expect(
        controller.invite(
          actor(owner.id, [RoleName.PARTNER_OWNER], mine.id),
          theirs.id,
          { phone: '+37491000001', role: RoleName.PARTNER_STAFF },
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it.each([RoleName.PARTNER_OWNER, RoleName.ADMIN, RoleName.SUPER_ADMIN, RoleName.CUSTOMER])(
      'refuses to hand out %s',
      async (role) => {
        const partner = await createPartner(prisma);
        const owner = await ownerOf(partner.id);

        await expect(
          invitations.invite({
            partnerId: partner.id,
            phone: '+37491000001',
            role,
            branchIds: [],
            createdByUserId: owner.id,
          }),
        ).rejects.toThrow(ForbiddenException);
      },
    );

    it('refuses a branch belonging to somebody else', async () => {
      const mine = await createPartner(prisma, { displayName: 'Mine' });
      const theirs = await createPartner(prisma, { displayName: 'Theirs' });
      const owner = await ownerOf(mine.id);
      const theirBranch = await branchOf(theirs.id, 'Theirs');

      await expect(
        invitations.invite({
          partnerId: mine.id,
          phone: '+37491000001',
          role: RoleName.PARTNER_STAFF,
          branchIds: [theirBranch.id],
          createdByUserId: owner.id,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuses a second open invitation to the same number', async () => {
      const partner = await createPartner(prisma);
      const owner = await ownerOf(partner.id);
      const invite = () =>
        invitations.invite({
          partnerId: partner.id,
          phone: '+37491000001',
          role: RoleName.PARTNER_STAFF,
          branchIds: [],
          createdByUserId: owner.id,
        });

      await invite();
      // Two live tokens for one person means revoking "the" invitation
      // leaves one working.
      await expect(invite()).rejects.toThrow(ConflictException);
    });

    it('refuses to invite somebody who already works here', async () => {
      const partner = await createPartner(prisma);
      const owner = await ownerOf(partner.id);
      const already = await stranger('+37491000009');
      await prisma.userRole.create({
        data: {
          userId: already.id,
          roleId: (await prisma.role.findFirstOrThrow({ where: { name: RoleName.PARTNER_STAFF } }))
            .id,
          partnerId: partner.id,
        },
      });

      await expect(
        invitations.invite({
          partnerId: partner.id,
          phone: already.phone,
          role: RoleName.PARTNER_MANAGER,
          branchIds: [],
          createdByUserId: owner.id,
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('accepting it', () => {
    const inviteTo = async (partnerId: string, phone: string, branchIds: string[] = []) => {
      const owner = await ownerOf(partnerId);
      await invitations.invite({
        partnerId,
        phone,
        role: RoleName.PARTNER_STAFF,
        branchIds,
        createdByUserId: owner.id,
      });
      return tokenFromMessage();
    };

    it('grants the role, the postings and a permanent code, all at once', async () => {
      const partner = await createPartner(prisma);
      const branch = await branchOf(partner.id, 'North');
      const invited = await stranger('+37491000002');
      const token = await inviteTo(partner.id, invited.phone, [branch.id]);

      const granted = await acceptController.accept(
        { ...actor(invited.id, [RoleName.CUSTOMER], partner.id, invited.phone), partnerScopes: {} },
        { token },
      );

      expect(granted.role).toBe(RoleName.PARTNER_STAFF);
      expect(granted.employeeCode).toMatch(/^EMP-\d{3}$/);
      expect(
        await prisma.userRole.count({ where: { userId: invited.id, partnerId: partner.id } }),
      ).toBe(1);
      expect(
        await prisma.partnerBranchStaffAssignment.count({
          where: { userId: invited.id, partnerBranchId: branch.id, isActive: true },
        }),
      ).toBe(1);
    });

    it('works exactly once', async () => {
      const partner = await createPartner(prisma);
      const invited = await stranger('+37491000003');
      const token = await inviteTo(partner.id, invited.phone);
      const caller = { ...actor(invited.id, [RoleName.CUSTOMER], partner.id, invited.phone), partnerScopes: {} };

      await acceptController.accept(caller, { token });

      await expect(acceptController.accept(caller, { token })).rejects.toThrow(BadRequestException);
    });

    it('refuses whoever merely holds the link', async () => {
      const partner = await createPartner(prisma);
      const invited = await stranger('+37491000004');
      const somebodyElse = await stranger('+37491000005');
      const token = await inviteTo(partner.id, invited.phone);

      await expect(
        acceptController.accept(
          { ...actor(somebodyElse.id, [RoleName.CUSTOMER], partner.id, somebodyElse.phone), partnerScopes: {} },
          { token },
        ),
      ).rejects.toThrow(BadRequestException);

      expect(await prisma.userRole.count({ where: { userId: somebodyElse.id } })).toBe(0);
    });

    it('refuses an expired invitation', async () => {
      const partner = await createPartner(prisma);
      const invited = await stranger('+37491000006');
      const token = await inviteTo(partner.id, invited.phone);
      await prisma.partnerStaffInvitation.updateMany({
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      await expect(
        acceptController.accept(
          { ...actor(invited.id, [RoleName.CUSTOMER], partner.id, invited.phone), partnerScopes: {} },
          { token },
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuses a revoked invitation, and revoking does not need the token', async () => {
      const partner = await createPartner(prisma);
      const owner = await ownerOf(partner.id);
      const invited = await stranger('+37491000007');
      await invitations.invite({
        partnerId: partner.id,
        phone: invited.phone,
        role: RoleName.PARTNER_STAFF,
        branchIds: [],
        createdByUserId: owner.id,
      });
      const token = tokenFromMessage();
      const row = await prisma.partnerStaffInvitation.findFirstOrThrow();

      await controller.revoke(
        actor(owner.id, [RoleName.PARTNER_OWNER], partner.id),
        partner.id,
        row.id,
      );

      await expect(
        acceptController.accept(
          { ...actor(invited.id, [RoleName.CUSTOMER], partner.id, invited.phone), partnerScopes: {} },
          { token },
        ),
      ).rejects.toThrow(BadRequestException);
    });

    /**
     * The requirement in the brief: powers changed or withdrawn cannot be
     * restored with an old invitation. The old token is dead from the moment
     * the new one is issued, not from the moment somebody notices.
     */
    it('kills the old token when the invitation is resent', async () => {
      const partner = await createPartner(prisma);
      const owner = await ownerOf(partner.id);
      const invited = await stranger('+37491000008');
      await invitations.invite({
        partnerId: partner.id,
        phone: invited.phone,
        role: RoleName.PARTNER_STAFF,
        branchIds: [],
        createdByUserId: owner.id,
      });
      const firstToken = tokenFromMessage();
      const row = await prisma.partnerStaffInvitation.findFirstOrThrow();

      await controller.resend(
        actor(owner.id, [RoleName.PARTNER_OWNER], partner.id),
        partner.id,
        row.id,
      );
      const secondToken = tokenFromMessage();
      expect(secondToken).not.toBe(firstToken);

      const caller = { ...actor(invited.id, [RoleName.CUSTOMER], partner.id, invited.phone), partnerScopes: {} };
      await expect(acceptController.accept(caller, { token: firstToken })).rejects.toThrow(
        BadRequestException,
      );
      await expect(acceptController.accept(caller, { token: secondToken })).resolves.toMatchObject({
        partnerId: partner.id,
      });
    });

    it('skips a branch archived between the offer and the acceptance', async () => {
      const partner = await createPartner(prisma);
      const open = await branchOf(partner.id, 'North');
      const closing = await branchOf(partner.id, 'South');
      const invited = await stranger('+37491000010');
      const token = await inviteTo(partner.id, invited.phone, [open.id, closing.id]);

      await partners.setBranchState(partner.id, closing.id, PartnerBranchState.ARCHIVED);

      const granted = await acceptController.accept(
        { ...actor(invited.id, [RoleName.CUSTOMER], partner.id, invited.phone), partnerScopes: {} },
        { token },
      );

      expect(granted.branchIds).toEqual([open.id]);
      expect(
        await prisma.partnerBranchStaffAssignment.count({
          where: { userId: invited.id, partnerBranchId: closing.id },
        }),
      ).toBe(0);
    });

    it('stops answering after too many refusals', async () => {
      const partner = await createPartner(prisma);
      const invited = await stranger('+37491000011');
      const somebodyElse = await stranger('+37491000012');
      const token = await inviteTo(partner.id, invited.phone);
      const wrongCaller = {
        ...actor(somebodyElse.id, [RoleName.CUSTOMER], partner.id, somebodyElse.phone),
        partnerScopes: {},
      };

      for (let i = 0; i < 10; i += 1) {
        await expect(acceptController.accept(wrongCaller, { token })).rejects.toThrow();
      }

      // Even the right person now has to ask for a new one: an invitation
      // somebody has been hammering is not one to keep answering.
      await expect(
        acceptController.accept(
          { ...actor(invited.id, [RoleName.CUSTOMER], partner.id, invited.phone), partnerScopes: {} },
          { token },
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('answers a made-up token the same way as a real one it will not honour', async () => {
      const partner = await createPartner(prisma);
      const invited = await stranger('+37491000013');
      const token = await inviteTo(partner.id, invited.phone);
      await prisma.partnerStaffInvitation.updateMany({
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      const caller = { ...actor(invited.id, [RoleName.CUSTOMER], partner.id, invited.phone), partnerScopes: {} };

      const refusals = await Promise.all(
        [token, 'obviously-not-a-real-token'].map((candidate) =>
          acceptController.accept(caller, { token: candidate }).catch((err: Error) => err.message),
        ),
      );

      expect(refusals[0]).toBe(refusals[1]);
    });
  });

  describe('what the owner sees', () => {
    it('lists invitations with a status a person can read', async () => {
      const partner = await createPartner(prisma);
      const owner = await ownerOf(partner.id);
      await invitations.invite({
        partnerId: partner.id,
        phone: '+37491000014',
        role: RoleName.PARTNER_STAFF,
        branchIds: [],
        createdByUserId: owner.id,
      });

      const listed = await controller.list(
        actor(owner.id, [RoleName.PARTNER_OWNER], partner.id),
        partner.id,
      );

      expect(listed).toHaveLength(1);
      expect(listed[0]!.status).toBe(PartnerStaffInvitationStatus.PENDING);
    });

    it('shows an overdue invitation as expired without a sweep having run', async () => {
      const partner = await createPartner(prisma);
      const owner = await ownerOf(partner.id);
      await invitations.invite({
        partnerId: partner.id,
        phone: '+37491000015',
        role: RoleName.PARTNER_STAFF,
        branchIds: [],
        createdByUserId: owner.id,
      });
      await prisma.partnerStaffInvitation.updateMany({
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      const listed = await controller.list(
        actor(owner.id, [RoleName.PARTNER_OWNER], partner.id),
        partner.id,
      );

      expect(listed[0]!.status).toBe('EXPIRED');
      // The column is untouched — the clock is what makes it expired.
      expect((await prisma.partnerStaffInvitation.findFirstOrThrow()).status).toBe(
        PartnerStaffInvitationStatus.PENDING,
      );
    });
  });
});

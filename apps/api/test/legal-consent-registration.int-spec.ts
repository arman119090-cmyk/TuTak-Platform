import { BadRequestException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { LegalConsentAction, LegalConsentPurpose, PrismaClient } from '@prisma/client';
import { join } from 'node:path';
import { AuthService } from '../src/modules/auth/auth.service';
import { LegalConsentService } from '../src/modules/legal/legal-consent.service';
import { LegalDocumentsController } from '../src/modules/legal/legal-documents.controller';
import { LegalDocumentsService } from '../src/modules/legal/legal-documents.service';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { SMS_PROVIDER, SmsProvider } from '../src/infrastructure/sms/sms-provider.interface';
import { PUSH_PROVIDER, PushMessage, PushProvider } from '../src/infrastructure/push/push-provider.interface';
import { IS_PUBLIC_KEY } from '../src/common/decorators/public.decorator';
import { createCustomer } from './setup/fixtures';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * Registration against a *published* legal package, on the real database.
 *
 * The shipped package cannot be published — `legal-publication-gate.spec.ts`
 * proves that, and it is the intended state until the owner fills in the
 * registration details and approves a revision. So this suite points the
 * service at a fixture package that is complete and approved, and then asks
 * the questions the brief asks (§5): can you register without choosing, does
 * the right edition end up in the record, does a repeat create a second
 * truth, does a withdrawal actually stop a marketing message.
 */
describe('Legal consent at registration (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let auth: AuthService;
  let documents: LegalDocumentsService;
  let consents: LegalConsentService;
  let legalController: LegalDocumentsController;
  let notifications: NotificationsService;
  let sms: SmsProvider;
  let push: PushProvider;

  const FIXTURE_REVISION = '1.0-test-2026-09-22';
  const PASSWORD = 'chosen-by-the-customer-1';

  beforeAll(async () => {
    process.env.LEGAL_CONTENT_DIR = join(__dirname, 'fixtures', 'legal');
    process.env.LEGAL_APPROVED_REVISION = FIXTURE_REVISION;
    harness = await createTestHarness();
    prisma = harness.prisma;
    auth = harness.app.get(AuthService);
    documents = harness.app.get(LegalDocumentsService);
    consents = harness.app.get(LegalConsentService);
    legalController = harness.app.get(LegalDocumentsController);
    notifications = harness.app.get(NotificationsService);
    sms = harness.app.get<SmsProvider>(SMS_PROVIDER);
    push = harness.app.get<PushProvider>(PUSH_PROVIDER);
  });

  afterAll(async () => {
    await harness.close();
    delete process.env.LEGAL_CONTENT_DIR;
    delete process.env.LEGAL_APPROVED_REVISION;
  });

  beforeEach(async () => {
    await truncateAll(prisma);
    jest.restoreAllMocks();
    // `truncateAll` empties the archive too; the service writes it at boot.
    // `reload` puts the gate back where boot left it — one test below closes
    // it on purpose.
    documents.reload();
    await documents.syncArchive();
  });

  const randomPhone = () => `+3746${Math.floor(Math.random() * 90_000_000 + 10_000_000)}`;

  const captureCode = (): (() => string) => {
    const spy = jest.spyOn(sms, 'send');
    return () => {
      const call = spy.mock.calls.at(-1);
      const match = call?.[0]?.body.match(/(\d{6})/);
      if (!match?.[1]) throw new Error('no code found in SMS body');
      return match[1];
    };
  };

  /** What an honest client sends: the two mandatory choices, quoting the texts it showed. */
  const acceptance = (language = 'ru') =>
    documents.requiredConsents().map((entry) => ({
      purpose: entry.purpose as LegalConsentPurpose,
      language,
      revision: documents.revision,
      documents: entry.documents.map((key) => ({
        key,
        contentHash: documents.getCurrent(key, language)!.contentHash,
      })),
    }));

  const register = async (phone: string, overrides: Record<string, unknown> = {}) => {
    const lastCode = captureCode();
    await auth.requestRegistrationOtp({ phone, consents: acceptance(), ...overrides } as never);
    return auth.verifyRegistrationOtp(
      { phone, code: lastCode(), deviceId: 'device-1', password: PASSWORD, consents: acceptance(), ...overrides } as never,
      {},
    );
  };

  it('publishes the fixture package and therefore enforces the choices', () => {
    expect(documents.publicationState().publishable).toBe(true);
    expect(documents.consentEnforced()).toBe(true);
  });

  // ── §5.1 ───────────────────────────────────────────────────────────────

  it('refuses registration without the mandatory choices, through the service the API calls', async () => {
    const phone = randomPhone();
    await expect(auth.requestRegistrationOtp({ phone } as never)).rejects.toBeInstanceOf(BadRequestException);

    // And no SMS was paid for, and no challenge exists: the refusal happens
    // before the number is processed any further.
    expect(await prisma.authOtpToken.count({ where: { phone } })).toBe(0);
  });

  it('refuses when only one of the two independent choices is made', async () => {
    const phone = randomPhone();
    const onlyTerms = acceptance().filter((entry) => entry.purpose === LegalConsentPurpose.TERMS_AND_BONUS_RULES);
    await expect(auth.requestRegistrationOtp({ phone, consents: onlyTerms } as never)).rejects.toMatchObject({
      response: { code: 'LEGAL_CONSENT_MISSING', purpose: LegalConsentPurpose.PERSONAL_DATA_REQUIRED },
    });
  });

  it('refuses a hash the server never published, so a client cannot invent evidence', async () => {
    const forged = acceptance();
    forged[0]!.documents[0]!.contentHash = 'f'.repeat(64);
    await expect(auth.requestRegistrationOtp({ phone: randomPhone(), consents: forged } as never)).rejects.toMatchObject(
      { response: { code: 'LEGAL_CONTENT_HASH_MISMATCH' } },
    );
  });

  it('refuses an edition that moved while the form was open', async () => {
    const stale = acceptance().map((entry) => ({ ...entry, revision: '0.1-yesterday' }));
    await expect(auth.requestRegistrationOtp({ phone: randomPhone(), consents: stale } as never)).rejects.toMatchObject({
      response: { code: 'LEGAL_REVISION_STALE', currentRevision: FIXTURE_REVISION },
    });
  });

  // ── §5.4: what is stored, and that it stays put ────────────────────────

  it('stores the edition, the language, the hash and the link to the phone confirmation', async () => {
    const phone = randomPhone();
    const result = await register(phone);

    const rows = await prisma.legalConsentRecord.findMany({ where: { userId: result.user.id } });
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.purpose))).toEqual(
      new Set([LegalConsentPurpose.TERMS_AND_BONUS_RULES, LegalConsentPurpose.PERSONAL_DATA_REQUIRED]),
    );

    for (const row of rows) {
      expect(row.action).toBe(LegalConsentAction.ACCEPT);
      expect(row.revision).toBe(FIXTURE_REVISION);
      expect(row.language).toBe('ru');
      expect(row.context).toBe('registration');
      expect(row.registrationChallengeId).toBeTruthy();
      // The challenge is the OTP row, and the record borrows only its id.
      const challenge = await prisma.authOtpToken.findUnique({ where: { id: row.registrationChallengeId! } });
      expect(challenge?.phone).toBe(phone);

      const documentsJson = row.documents as Array<{ documentKey: string; contentHash: string }>;
      expect(documentsJson).toHaveLength(2);
      for (const doc of documentsJson) {
        expect(doc.contentHash).toBe(documents.getCurrent(doc.documentKey, 'ru')!.contentHash);
      }

      // Nothing secret may be in the evidence: not the code, not the password.
      const serialized = JSON.stringify(row);
      expect(serialized).not.toContain(PASSWORD);
      expect(serialized).not.toMatch(/"code"/);
    }
  });

  it('keeps the accepted edition readable afterwards, byte for byte', async () => {
    const phone = randomPhone();
    const result = await register(phone);
    const row = await prisma.legalConsentRecord.findFirstOrThrow({ where: { userId: result.user.id } });
    const accepted = (row.documents as Array<{ documentKey: string; contentHash: string }>)[0]!;

    const archived = await documents.getArchived(accepted.documentKey, 'ru', row.revision);
    expect(archived?.contentHash).toBe(accepted.contentHash);
    expect(archived?.content).toContain('fixture');
  });

  it('refuses to rewrite a published edition in place, and says so instead', async () => {
    // Somebody edits the text of an already-published revision. The archive
    // is what an accepted copy resolves against, so it must not move: the
    // correct outcome is a blocked gate, not an updated row.
    const before = await prisma.legalDocumentRevision.findFirstOrThrow({
      where: { documentKey: 'terms', language: 'ru', revision: FIXTURE_REVISION },
    });
    await prisma.legalDocumentRevision.update({
      where: { id: before.id },
      data: { content: 'tampered', contentHash: 'a'.repeat(64) },
    });

    await documents.syncArchive();

    const after = await prisma.legalDocumentRevision.findUniqueOrThrow({ where: { id: before.id } });
    expect(after.content).toBe('tampered');
    expect(documents.publicationState().blockers).toContain('archived-text-changed:terms:ru');
    expect(documents.publicationState().publishable).toBe(false);
  });

  // ── §5.5: repeats and parallel requests ────────────────────────────────

  it('collapses a repeated submit of the same choice onto one record', async () => {
    const { user } = await createCustomer(prisma, { phone: randomPhone() });
    const validated = acceptance().map((entry) => consents.validate(entry));

    await consents.recordAccepted(prisma, {
      userId: user.id,
      consents: validated,
      context: 'registration',
      scope: 'challenge-1',
    });
    await consents.recordAccepted(prisma, {
      userId: user.id,
      consents: validated,
      context: 'registration',
      scope: 'challenge-1',
    });

    expect(await prisma.legalConsentRecord.count({ where: { userId: user.id } })).toBe(2);
  });

  it('survives two registrations racing the same code: one account, one set of records', async () => {
    const phone = randomPhone();
    const lastCode = captureCode();
    await auth.requestRegistrationOtp({ phone, consents: acceptance() } as never);
    const code = lastCode();

    const attempt = () =>
      auth.verifyRegistrationOtp(
        { phone, code, deviceId: 'device-1', password: PASSWORD, consents: acceptance() } as never,
        {},
      );
    const outcomes = await Promise.allSettled([attempt(), attempt()]);

    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(await prisma.user.count({ where: { phone } })).toBe(1);
    const user = await prisma.user.findUniqueOrThrow({ where: { phone } });
    expect(await prisma.legalConsentRecord.count({ where: { userId: user.id } })).toBe(2);
  });

  // ── §5.2: refusing everything voluntary changes nothing that matters ───

  it('registers an account that agreed to nothing voluntary, and reports no grant it never got', async () => {
    const result = await register(randomPhone());

    expect(result.tokens.accessToken).toBeTruthy();
    for (const purpose of [
      LegalConsentPurpose.MARKETING_SMS,
      LegalConsentPurpose.MARKETING_PUSH,
      LegalConsentPurpose.MARKETING_EMAIL,
      LegalConsentPurpose.PERSONALIZED_RECOMMENDATIONS,
      LegalConsentPurpose.AVATAR_IN_REFERRAL_LIST,
    ]) {
      expect(await consents.isGranted(result.user.id, purpose)).toBe(false);
    }

    const user = await prisma.user.findUniqueOrThrow({ where: { id: result.user.id } });
    expect(user.personalizedRecommendationsConsent).toBe(false);
    expect(user.avatarConsentReferralList).toBe(false);
  });

  // ── §5.6: a withdrawal stops marketing, and only marketing ─────────────

  it('stops a marketing message after the withdrawal, including one already composed', async () => {
    const { user } = await createCustomer(prisma, { phone: randomPhone() });
    await prisma.device.create({
      data: { userId: user.id, deviceId: 'd1', pushToken: 'ExponentPushToken[x]', platform: 'ANDROID' },
    });
    const sent: PushMessage[][] = [];
    jest.spyOn(push, 'send').mockImplementation((messages) => {
      sent.push(messages);
      return Promise.resolve({ invalidTokens: [], delivered: messages.length });
    });

    await consents.record({
      userId: user.id,
      purpose: LegalConsentPurpose.MARKETING_PUSH,
      action: LegalConsentAction.ACCEPT,
      language: 'ru',
      context: 'settings',
    });

    const granted = await notifications.send({
      userId: user.id,
      titleKey: 'promo.title',
      bodyKey: 'promo.body',
      push: { title: 'Promo', body: '−20%' },
      marketing: LegalConsentPurpose.MARKETING_PUSH,
    });
    expect(granted).not.toBeNull();
    expect(sent).toHaveLength(1);

    await consents.record({
      userId: user.id,
      purpose: LegalConsentPurpose.MARKETING_PUSH,
      action: LegalConsentAction.REVOKE,
      language: 'ru',
      context: 'settings',
    });

    const withheld = await notifications.send({
      userId: user.id,
      titleKey: 'promo.title',
      bodyKey: 'promo.body',
      push: { title: 'Promo', body: '−20%' },
      marketing: LegalConsentPurpose.MARKETING_PUSH,
    });
    expect(withheld).toBeNull();
    expect(sent).toHaveLength(1);

    // The service message the account needs is not marketing and is not
    // silenced with it.
    const service = await notifications.send({
      userId: user.id,
      titleKey: 'notifications.transactionCompletedTitle',
      bodyKey: 'notifications.transactionCompletedBody',
      push: { title: 'Paid', body: '5000 AMD' },
    });
    expect(service).not.toBeNull();
    expect(sent).toHaveLength(2);

    // And the grant that was withdrawn is still in the history.
    const rows = await prisma.legalConsentRecord.findMany({
      where: { userId: user.id, purpose: LegalConsentPurpose.MARKETING_PUSH },
      orderBy: { recordedAt: 'asc' },
    });
    expect(rows.map((row) => row.action)).toEqual([LegalConsentAction.ACCEPT, LegalConsentAction.REVOKE]);
  });

  // ── §5.3: readable and saveable before there is an account ─────────────

  it('serves every document, and a saveable copy, with no account and no OTP', async () => {
    const list = legalController.list('ru');
    expect(list.published).toBe(true);
    expect(list.documents.map((doc) => doc.key).sort()).toEqual(
      ['account-deletion', 'bonus-refunds', 'consent', 'privacy', 'terms'].sort(),
    );

    const terms = await legalController.get('terms', 'ru');
    expect(terms.content).toContain('fixture');
    expect(terms.contentHash).toBe(documents.getCurrent('terms', 'ru')!.contentHash);

    const headers: Record<string, string> = {};
    let body = '';
    const res = {
      setHeader: (name: string, value: string) => {
        headers[name] = value;
      },
      status: () => res,
      send: (payload: string) => {
        body = payload;
      },
    } as never;
    await legalController.file(res, 'terms', 'ru');
    expect(body).toBe(terms.content);
    expect(headers['X-Legal-Content-Sha256']).toBe(terms.contentHash);
    expect(headers['Content-Disposition']).toContain(`tutak-terms-${FIXTURE_REVISION}-ru.md`);
  });

  it('leaves those three routes open to a caller with no token, and the gate state closed', () => {
    // The test above calls the controller directly, which proves the answer
    // but not that a stranger may ask. This is the guard's own metadata.
    const reflector = new Reflector();
    for (const handler of [
      LegalDocumentsController.prototype.list,
      LegalDocumentsController.prototype.get,
      LegalDocumentsController.prototype.file,
    ]) {
      expect(reflector.get(IS_PUBLIC_KEY, handler)).toBe(true);
    }
    // And the blocker list, which names unfilled company details, is not.
    expect(reflector.get(IS_PUBLIC_KEY, LegalDocumentsController.prototype.publicationState)).toBeUndefined();
  });

  it('offers the languages it really has instead of passing one off as another', async () => {
    expect(() => legalController.list('en')).toThrow(BadRequestException);
    try {
      legalController.list('en');
    } catch (err) {
      expect((err as BadRequestException).getResponse()).toMatchObject({
        code: 'LEGAL_LANGUAGE_UNSUPPORTED',
        available: ['ru', 'hy'],
      });
    }

    const armenian = await legalController.get('privacy', 'hy');
    expect(armenian.language).toBe('hy');
    expect(armenian.contentHash).toBe(documents.getCurrent('privacy', 'hy')!.contentHash);
  });

  // ── no retroactive consent ─────────────────────────────────────────────

  it('never writes a consent for an account that registered before the texts existed', async () => {
    const { user: existing } = await createCustomer(prisma, { phone: randomPhone() });
    expect(await prisma.legalConsentRecord.count({ where: { userId: existing.id } })).toBe(0);
    expect(await consents.currentState(existing.id)).toEqual([]);
  });
});

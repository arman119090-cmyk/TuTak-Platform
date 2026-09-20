import { CryptoService } from '../../src/common/crypto/crypto.service';
import {
  createHarness,
  Harness,
  resetDatabase,
  seedDriver,
  seedPark,
  seedPricing,
  testEnv,
} from '../harness';

const OLD_KEY = 'd'.repeat(64);
const NEW_KEY = 'e'.repeat(64);

/**
 * A rotation, end to end: rows written under the old key, the process
 * restarted with the new key active and the old one retired, the job run.
 */
describe('encryption key rotation', () => {
  let harness: Harness;
  /** Encrypts as the *previous* deployment did. */
  let oldCrypto: CryptoService;

  beforeAll(async () => {
    harness = await createHarness({
      ENCRYPTION_KEY: NEW_KEY,
      ENCRYPTION_KEY_ID: 'k2',
      ENCRYPTION_PREVIOUS_KEYS: `k1:${OLD_KEY}` as never,
    });
    oldCrypto = new CryptoService(testEnv({ ENCRYPTION_KEY: OLD_KEY, ENCRYPTION_KEY_ID: 'k1' }));
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await resetDatabase(harness.prisma);
    await harness.rateLimiter.resetAll();
    await seedPricing(harness.prisma);
  });

  async function seedOldRows() {
    const park = await seedPark(harness, { yandexParkId: 'park-rot' });
    await harness.prisma.parkIntegrationCredential.create({
      data: {
        parkId: park.id,
        clientId: 'taxi/park/rot',
        apiKeyEnc: oldCrypto.encrypt('old-park-key'),
        apiKeyHint: 'key',
      },
    });
    const driver = await seedDriver(harness, { phone: '+37411000777', parkId: 'park-rot' });
    // seedDriver's card token was written by the *new* process (already k2);
    // add one more method under the old key.
    await harness.prisma.payoutMethod.create({
      data: {
        driverId: driver.driverId,
        kind: 'CARD',
        status: 'ACTIVE',
        currency: 'AMD',
        providerTokenEnc: oldCrypto.encrypt('tok_old_1111'),
        maskedIdentifier: '•••• 1111',
        fingerprint: 'fp-old-1111',
      },
    });
    await harness.prisma.adminUser.create({
      data: {
        email: 'rot@example.com',
        passwordHash: 'x',
        role: 'VIEWER',
        mfaSecretEnc: oldCrypto.encrypt('JBSWY3DPEHPK3PXP'),
      },
    });
    await harness.prisma.adminUser.create({
      data: { email: 'nomfa@example.com', passwordHash: 'x', role: 'VIEWER', mfaSecretEnc: null },
    });
    return { park, driver };
  }

  it('the new process still reads rows under the retired key, and writes under the active one', async () => {
    const envelope = oldCrypto.encrypt('secret');
    expect(harness.crypto.keyIdOf(envelope)).toBe('k1');
    expect(harness.crypto.decrypt(envelope)).toBe('secret');
    expect(harness.crypto.keyIdOf(harness.crypto.encrypt('secret'))).toBe('k2');
    expect(harness.crypto.isCurrent(envelope)).toBe(false);
  });

  it('refuses a key it does not hold, naming the ids without the plaintext', () => {
    const stranger = new CryptoService(
      testEnv({ ENCRYPTION_KEY: 'f'.repeat(64), ENCRYPTION_KEY_ID: 'k9' }),
    );
    expect(() => harness.crypto.decrypt(stranger.encrypt('secret'))).toThrow(
      /key "k9".*active "k2".*k1/,
    );
  });

  it('inventory counts rows per key id per column', async () => {
    await seedOldRows();
    const inventory = await harness.keyRotation.inventory();
    expect(inventory['parkIntegrationCredential.apiKeyEnc']).toEqual({ k1: 1 });
    expect(inventory['payoutMethod.providerTokenEnc']).toEqual({ k1: 1, k2: 1 });
    expect(inventory['adminUser.mfaSecretEnc']).toEqual({ k1: 1 });
  });

  it('dry run verifies every row and writes nothing', async () => {
    await seedOldRows();
    const before = await harness.prisma.parkIntegrationCredential.findFirstOrThrow();

    const report = await harness.keyRotation.run({ dryRun: true });
    expect(report.status).toBe('COMPLETED');
    expect(report.runId).toBeNull();
    expect(report.targets['parkIntegrationCredential.apiKeyEnc']).toMatchObject({
      scanned: 1,
      reencrypted: 1,
      current: 0,
      failed: 0,
    });
    expect(report.targets['payoutMethod.providerTokenEnc']).toMatchObject({
      scanned: 2,
      current: 1,
      reencrypted: 1,
    });
    expect(report.targets['adminUser.mfaSecretEnc']).toMatchObject({ scanned: 1, reencrypted: 1 });

    const after = await harness.prisma.parkIntegrationCredential.findFirstOrThrow();
    expect(after.apiKeyEnc).toBe(before.apiKeyEnc);
    expect(await harness.prisma.encryptionKeyRotation.count()).toBe(0);
    expect(
      await harness.prisma.auditLog.count({ where: { action: 'security.key_rotation_dry_run' } }),
    ).toBe(1);
  });

  it('re-encrypts every old row under the active key, keeps the plaintext, records the run, and is idempotent', async () => {
    await seedOldRows();

    const first = await harness.keyRotation.run({ dryRun: false, batchSize: 1 });
    expect(first.status).toBe('COMPLETED');
    expect(first.runId).not.toBeNull();
    expect(first.targets['parkIntegrationCredential.apiKeyEnc']).toMatchObject({
      reencrypted: 1,
      skipped: 0,
      failed: 0,
    });
    expect(first.targets['payoutMethod.providerTokenEnc']).toMatchObject({
      reencrypted: 1,
      current: 1,
    });
    expect(first.targets['adminUser.mfaSecretEnc']).toMatchObject({ reencrypted: 1 });

    const inventory = await harness.keyRotation.inventory();
    expect(inventory['parkIntegrationCredential.apiKeyEnc']).toEqual({ k2: 1 });
    expect(inventory['payoutMethod.providerTokenEnc']).toEqual({ k2: 2 });
    expect(inventory['adminUser.mfaSecretEnc']).toEqual({ k2: 1 });

    // The plaintext survived, readable through the ordinary service path.
    const credential = await harness.prisma.parkIntegrationCredential.findFirstOrThrow();
    expect(harness.crypto.decrypt(credential.apiKeyEnc)).toBe('old-park-key');
    const method = await harness.prisma.payoutMethod.findFirstOrThrow({
      where: { fingerprint: 'fp-old-1111' },
    });
    expect(harness.crypto.decrypt(method.providerTokenEnc)).toBe('tok_old_1111');

    const runs = await harness.keyRotation.runs();
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ activeKeyId: 'k2', dryRun: false, status: 'COMPLETED' });
    expect(runs[0]!.finishedAt).not.toBeNull();

    // Second run: everything is current, nothing is rewritten.
    const second = await harness.keyRotation.run({ dryRun: false });
    expect(second.targets['parkIntegrationCredential.apiKeyEnc']).toMatchObject({
      current: 1,
      reencrypted: 0,
    });
    expect(await harness.prisma.parkIntegrationCredential.findFirstOrThrow()).toEqual(credential);
  });

  it('skips, rather than clobbers, a row rewritten while the job runs', async () => {
    const { park } = await seedOldRows();
    // Simulate a request replacing the credential between the job's read and write.
    const original = harness.prisma.parkIntegrationCredential.updateMany.bind(
      harness.prisma.parkIntegrationCredential,
    );
    let raced = false;
    const spy = jest
      .spyOn(harness.prisma.parkIntegrationCredential, 'updateMany')
      .mockImplementation((async (args: Parameters<typeof original>[0]) => {
        if (!raced) {
          raced = true;
          await original({
            where: { parkId: park.id },
            data: { apiKeyEnc: harness.crypto.encrypt('replaced-by-request') },
          });
        }
        return original(args);
      }) as never);

    const report = await harness.keyRotation.run({ dryRun: false });
    spy.mockRestore();
    expect(report.targets['parkIntegrationCredential.apiKeyEnc']).toMatchObject({
      skipped: 1,
      reencrypted: 0,
      failed: 0,
    });
    const credential = await harness.prisma.parkIntegrationCredential.findFirstOrThrow();
    expect(harness.crypto.decrypt(credential.apiKeyEnc)).toBe('replaced-by-request');
  });

  it('a row under a key the process does not hold is reported as failed and the run continues', async () => {
    await seedOldRows();
    const stranger = new CryptoService(
      testEnv({ ENCRYPTION_KEY: 'f'.repeat(64), ENCRYPTION_KEY_ID: 'k0' }),
    );
    await harness.prisma.adminUser.create({
      data: {
        email: 'lost@example.com',
        passwordHash: 'x',
        role: 'VIEWER',
        mfaSecretEnc: stranger.encrypt('LOST'),
      },
    });

    const report = await harness.keyRotation.run({ dryRun: false });
    expect(report.status).toBe('COMPLETED_WITH_FAILURES');
    expect(report.targets['adminUser.mfaSecretEnc']).toMatchObject({
      scanned: 2,
      reencrypted: 1,
      failed: 1,
      byKeyId: { k1: 1, k0: 1 },
    });
    // The rest of the run still happened.
    expect(report.targets['parkIntegrationCredential.apiKeyEnc']).toMatchObject({ reencrypted: 1 });
    const runs = await harness.keyRotation.runs();
    expect(runs[0]).toMatchObject({ status: 'COMPLETED_WITH_FAILURES' });
    expect(runs[0]!.lastError).toContain('could not be re-encrypted');
  });
});

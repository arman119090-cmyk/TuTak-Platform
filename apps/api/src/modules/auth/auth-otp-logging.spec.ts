import { Logger } from '@nestjs/common';
import { AuthOtpPurpose } from '@prisma/client';
import { AuthOtpService } from './auth-otp.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { OtpIpRateLimitService } from './otp-ip-rate-limit.service';
import { SmsProvider } from '../../infrastructure/sms/sms-provider.interface';

/**
 * A failed SMS delivery has to be diagnosable, and the line that makes it
 * diagnosable used to print the customer's phone number. With a real carrier
 * now wired up, this is no longer a hypothetical path: a carrier outage
 * writes one of these per sign-in attempt, and the result is a list of who
 * was trying to sign in, in whatever log sink the deployment ships to.
 */
describe('AuthOtpService — what a delivery failure is allowed to say', () => {
  const PHONE = '+37493600600';

  function build(send: jest.Mock) {
    const prisma = {
      authOtpToken: { count: jest.fn().mockResolvedValue(0) },
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<void>) =>
        fn({
          authOtpToken: {
            updateMany: jest.fn().mockResolvedValue({ count: 0 }),
            create: jest.fn().mockResolvedValue({}),
          },
        }),
      ),
    } as unknown as PrismaService;
    const ipRateLimit = { consume: jest.fn().mockResolvedValue(undefined) } as unknown as OtpIpRateLimitService;
    return new AuthOtpService(prisma, ipRateLimit, { name: 'stub', send } as unknown as SmsProvider);
  }

  afterEach(() => jest.restoreAllMocks());

  it('reports the failure without the number, and still answers the caller', async () => {
    const written: string[] = [];
    jest.spyOn(Logger.prototype, 'error').mockImplementation((m) => void written.push(String(m)));

    const send = jest.fn().mockRejectedValue(new Error('Could not send the SMS message'));
    const service = build(send);

    // A carrier failure must not turn into an enumeration oracle either: the
    // call still resolves, and `delivered` is for the server's own log — see
    // the describe below. It never reaches the wire.
    await expect(service.requestCode(PHONE, AuthOtpPurpose.LOGIN)).resolves.toEqual({
      success: true,
      delivered: false,
    });

    const log = written.join('\n');
    expect(log).toContain('Could not deliver OTP');
    expect(log).not.toContain(PHONE);
    expect(log).not.toContain('93600600');

    // And the code itself, which the provider was handed, is not in there.
    const code = (send.mock.calls[0]![0] as { templateParams: string[] }).templateParams[0]!;
    expect(code).toMatch(/^\d{6}$/);
    expect(log).not.toContain(code);
  });

  it('writes nothing at all when the carrier accepts the message', async () => {
    const written: string[] = [];
    jest.spyOn(Logger.prototype, 'error').mockImplementation((m) => void written.push(String(m)));

    await build(jest.fn().mockResolvedValue({})).requestCode(PHONE, AuthOtpPurpose.REGISTER);
    expect(written).toEqual([]);
  });
});

/**
 * What requestCode reports back to its caller.
 *
 * From outside, three different things look the same: a request that never
 * arrived, a number with no account, and a carrier that refused. The client is
 * told `success: true` in all three — that is the anti-enumeration contract and
 * it stays. So the log is the only place the difference can live, and two of
 * the three used to write nothing at all. An evening of testing produced no
 * record of whether the requests had even been received.
 *
 * This is the half that makes the third case visible: the caller is now told
 * whether the carrier took the message, without the answer on the wire
 * changing at all.
 */
describe('AuthOtpService — what requestCode reports back', () => {
  function buildWith(send: jest.Mock) {
    const prisma = {
      authOtpToken: { count: jest.fn().mockResolvedValue(0) },
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<void>) =>
        fn({
          authOtpToken: {
            updateMany: jest.fn().mockResolvedValue({ count: 0 }),
            create: jest.fn().mockResolvedValue({}),
          },
        }),
      ),
    } as unknown as PrismaService;
    const ipRateLimit = {
      consume: jest.fn().mockResolvedValue(undefined),
    } as unknown as OtpIpRateLimitService;
    return new AuthOtpService(prisma, ipRateLimit, { name: 'stub', send } as unknown as SmsProvider);
  }

  afterEach(() => jest.restoreAllMocks());

  it('says the code reached the carrier when the carrier took it', async () => {
    const service = buildWith(jest.fn().mockResolvedValue({ providerMessageId: 'x' }));

    await expect(service.requestCode('+37493600600', AuthOtpPurpose.LOGIN)).resolves.toEqual({
      success: true,
      delivered: true,
    });
  });

  it('says it did not, without failing the caller', async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const service = buildWith(jest.fn().mockRejectedValue(new Error('no carrier')));

    // Still resolves: the uniform answer to the client is deliberate.
    await expect(service.requestCode('+37493600600', AuthOtpPurpose.LOGIN)).resolves.toEqual({
      success: true,
      delivered: false,
    });
  });
});

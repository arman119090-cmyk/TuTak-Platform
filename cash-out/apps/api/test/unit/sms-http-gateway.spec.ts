import { AppLogger } from '../../src/common/logging/logger.service';
import {
  SmsHttpGatewayBase,
  smsErrorFromStatus,
} from '../../src/modules/auth/sms-http-gateway.base';
import { SendOtpInput, SmsSendResult } from '../../src/modules/auth/sms-gateway.port';
import { IntegrationHealthRecorder } from '../../src/modules/integration-health/integration-health.recorder';
import { testEnv } from '../harness';

const logger = new AppLogger(testEnv());

class RecorderSpy extends IntegrationHealthRecorder {
  readonly calls: Array<{ integration: string; ok: boolean; error?: string }> = [];
  constructor() {
    super(null as never, null as never);
  }
  override async record(integration: string, ok: boolean, error?: string): Promise<void> {
    this.calls.push({ integration, ok, error });
  }
}

/** A provider adapter reduced to a scripted sequence of attempts. */
class ScriptedGateway extends SmsHttpGatewayBase {
  readonly name = 'sms-scripted';
  attempts = 0;
  constructor(
    private readonly script: Array<SmsSendResult | 'throw' | 'hang'>,
    health: RecorderSpy,
    maxRetries = 2,
  ) {
    super({ timeoutMs: 50, maxRetries, retryBaseDelayMs: 1 }, logger, health);
  }
  protected async request(_input: SendOtpInput, signal: AbortSignal): Promise<SmsSendResult> {
    const step = this.script[this.attempts] ?? this.script[this.script.length - 1]!;
    this.attempts += 1;
    if (step === 'throw') throw new Error('socket hang up');
    if (step === 'hang') {
      await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve()));
      throw new Error('aborted');
    }
    return step;
  }
  async ping(): Promise<boolean> {
    return true;
  }
}

const input: SendOtpInput = {
  phone: '+37491000001',
  code: '123456',
  locale: 'hy',
  reference: 'c1',
};

describe('SmsHttpGatewayBase', () => {
  it('accepts on the first try and records health', async () => {
    const health = new RecorderSpy();
    const gateway = new ScriptedGateway([{ accepted: true, providerMessageId: 'm1' }], health);
    await expect(gateway.sendOtp(input)).resolves.toEqual({
      accepted: true,
      providerMessageId: 'm1',
    });
    expect(gateway.attempts).toBe(1);
    expect(health.calls).toEqual([{ integration: 'sms-scripted', ok: true, error: undefined }]);
  });

  it('retries retryable failures with backoff, then succeeds', async () => {
    const health = new RecorderSpy();
    const gateway = new ScriptedGateway(
      [
        { accepted: false, error: { code: 'PROVIDER_UNAVAILABLE', retryable: true } },
        'throw',
        { accepted: true, providerMessageId: null },
      ],
      health,
    );
    await expect(gateway.sendOtp(input)).resolves.toEqual({
      accepted: true,
      providerMessageId: null,
    });
    expect(gateway.attempts).toBe(3);
  });

  it('gives up after maxRetries and reports the last error', async () => {
    const health = new RecorderSpy();
    const gateway = new ScriptedGateway(['throw'], health, 2);
    const result = await gateway.sendOtp(input);
    expect(result.accepted).toBe(false);
    expect(!result.accepted && result.error.code).toBe('PROVIDER_UNAVAILABLE');
    expect(gateway.attempts).toBe(3);
    expect(health.calls).toEqual([
      { integration: 'sms-scripted', ok: false, error: 'PROVIDER_UNAVAILABLE' },
    ]);
  });

  it('never retries a non-retryable refusal', async () => {
    const health = new RecorderSpy();
    const gateway = new ScriptedGateway(
      [{ accepted: false, error: { code: 'INVALID_NUMBER', retryable: false } }],
      health,
    );
    const result = await gateway.sendOtp(input);
    expect(!result.accepted && result.error.code).toBe('INVALID_NUMBER');
    expect(gateway.attempts).toBe(1);
  });

  it('a hung provider becomes TIMEOUT, retryable', async () => {
    const health = new RecorderSpy();
    const gateway = new ScriptedGateway(['hang'], health, 1);
    const result = await gateway.sendOtp(input);
    expect(!result.accepted && result.error).toEqual({ code: 'TIMEOUT', retryable: true });
    expect(gateway.attempts).toBe(2);
  });

  it('maps HTTP statuses to normalised errors', () => {
    expect(smsErrorFromStatus(401).code).toBe('AUTH_FAILED');
    expect(smsErrorFromStatus(402).code).toBe('INSUFFICIENT_FUNDS');
    expect(smsErrorFromStatus(429)).toMatchObject({ code: 'RATE_LIMITED', retryable: true });
    expect(smsErrorFromStatus(503)).toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
      retryable: true,
    });
    expect(smsErrorFromStatus(400)).toMatchObject({ code: 'REJECTED', retryable: false });
  });
});

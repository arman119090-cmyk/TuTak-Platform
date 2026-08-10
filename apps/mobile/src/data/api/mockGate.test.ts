import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { DEMO_APP_ENV, shouldUseMocks } from './mockGate';

/**
 * What stops a demonstration from becoming an authentication bypass.
 *
 * The mock transport accepts any phone and any password. In `demo/` that is
 * the point — there is nothing to authenticate against and a preview that
 * refuses to open is useless. In anything installed as TuTak it is a way into
 * somebody's wallet.
 *
 * So the distance between the two is structural, and these tests are what
 * keep it structural: two independent flags, and a production config that
 * can produce neither.
 */
describe('shouldUseMocks', () => {
  it('answers from memory only when both flags agree', () => {
    expect(shouldUseMocks({ useMocks: true, appEnv: DEMO_APP_ENV })).toBe(true);
  });

  it.each([
    ['useMocks alone', { useMocks: true, appEnv: 'production' }],
    ['useMocks alone, on a preview build', { useMocks: true, appEnv: 'preview' }],
    ['useMocks alone, with no appEnv at all', { useMocks: true }],
    ['the demo name alone', { appEnv: DEMO_APP_ENV }],
    ['the demo name with mocks off', { useMocks: false, appEnv: DEMO_APP_ENV }],
    ['nothing', {}],
  ])('talks to the real API when it has only %s', (_case, extra) => {
    expect(shouldUseMocks(extra)).toBe(false);
  });

  it('talks to the real API when there is no config to read', () => {
    // `Constants.expoConfig` is nullable. Failing towards the server is the
    // safe direction: a demo that cannot load data is visible in a second,
    // a build that lets anybody in is not visible at all.
    expect(shouldUseMocks(null)).toBe(false);
    expect(shouldUseMocks(undefined)).toBe(false);
  });

  it.each([
    ['the string "true"', { useMocks: 'true', appEnv: DEMO_APP_ENV }],
    ['1', { useMocks: 1, appEnv: DEMO_APP_ENV }],
    ['a truthy object', { useMocks: {}, appEnv: DEMO_APP_ENV }],
  ])('is not fooled by %s', (_case, extra) => {
    // JSON round-trips through app config; a value that arrives as a string
    // must not switch off authentication.
    expect(shouldUseMocks(extra)).toBe(false);
  });
});

describe("the production config cannot produce either flag", () => {
  const mobileRoot = join(__dirname, '../../..');

  const readConfig = (appEnv: string, extraEnv: Record<string, string> = {}) =>
    JSON.parse(
      execFileSync('npx', ['expo', 'config', '--type', 'public', '--json'], {
        cwd: mobileRoot,
        env: { ...process.env, APP_ENV: appEnv, ...extraEnv },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }),
    );

  it.each([
    ['development', {}],
    ['preview', { API_BASE_URL: 'https://api.example.com/v1' }],
    ['production', { API_BASE_URL: 'https://api.example.com/v1' }],
  ])('pins useMocks to false on the %s profile', (appEnv, extraEnv) => {
    const config = readConfig(appEnv, extraEnv);

    expect(config.extra.useMocks).toBe(false);
    expect(config.extra.appEnv).toBe(appEnv);
    // Both halves of the gate, asserted through the real config rather than
    // by reading the file.
    expect(shouldUseMocks(config.extra)).toBe(false);
  });

  it('refuses to build at all when APP_ENV says demo', () => {
    // The second lock. Without it, one environment variable on an EAS profile
    // would be the whole distance to an installable app with no
    // authentication in it.
    expect(() => readConfig('demo')).toThrow();
  });
});

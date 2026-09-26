import { buildInfoLine } from './BuildInfo';

/**
 * The line a tester photographs when something is wrong.
 *
 * The expensive question through every round of this has been "which build is
 * on the phone, and what is it talking to". `app.config.js` marks the icon
 * "TuTak (staging)" because that was the only answer available anywhere in
 * the product; this is the rest of it.
 */
describe('buildInfoLine', () => {
  it('names the environment, the API host and the commit on a staging build', () => {
    expect(
      buildInfoLine(
        {
          appEnv: 'staging',
          apiBaseUrl: 'https://tutak-staging-api.onrender.com/v1',
          commit: 'c764235aa682aa8c7a0e2f5c099d1f7dd57f7865',
        },
        '0.1.0',
      ),
    ).toBe('TuTak · v0.1.0 · staging · tutak-staging-api.onrender.com · c764235');
  });

  it('shows the host without the /v1 path', () => {
    // The host answers "is this pointing where I think it is". The path is
    // the same on every build and only makes the line harder to read.
    const line = buildInfoLine(
      { appEnv: 'preview', apiBaseUrl: 'https://api.example.test/v1' },
      '0.1.0',
    );
    expect(line).toContain('api.example.test');
    expect(line).not.toContain('/v1');
  });

  it('says nothing beyond the version on a production build', () => {
    // By then the answer is not in question, and the space belongs to the
    // customer rather than to us.
    expect(
      buildInfoLine(
        {
          appEnv: 'production',
          apiBaseUrl: 'https://api.tutak.am/v1',
          commit: 'c764235aa682aa8c7a0e2f5c099d1f7dd57f7865',
        },
        '0.1.0',
      ),
    ).toBe('TuTak · v0.1.0');
  });

  it('degrades to the version alone rather than throwing on an empty config', () => {
    // `extra` is absent in a few real situations — Expo Go, a manifest that
    // did not reach the build. A footer is not worth a crash.
    expect(buildInfoLine(undefined, undefined)).toBe('TuTak · v0.1.0');
    expect(buildInfoLine({}, '0.2.0')).toBe('TuTak · v0.2.0');
  });

  it('omits a part it was given nothing for', () => {
    expect(buildInfoLine({ appEnv: 'staging' }, '0.1.0')).toBe('TuTak · v0.1.0 · staging');
  });
});

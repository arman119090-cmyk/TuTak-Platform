import Constants from 'expo-constants';
import { getEvents, logEvent, resetEvents } from './eventLog';
import { buildCommit, isDiagnosticBuild } from './isDiagnosticBuild';

jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: {} } }));

const setExtra = (extra: Record<string, unknown> | null) => {
  (Constants as { expoConfig: unknown }).expoConfig = extra === null ? null : { extra };
};

describe('the diagnostic event log', () => {
  beforeEach(resetEvents);

  /**
   * The count is the finding.
   *
   * The whole question this log exists to answer is "how many times". Two
   * `keyboardDidShow` events is Android reporting a corrected height; forty is
   * a loop. If repeats were appended as separate rows they would push the
   * surrounding sequence off a phone screen and hide the very context that
   * distinguishes those two cases.
   */
  it('counts a repeated event instead of pushing the rest off the screen', () => {
    logEvent('focus Phone');
    logEvent('kbShow h=300');
    logEvent('kbShow h=300');
    logEvent('kbShow h=300');

    expect(getEvents().map((e) => e.text)).toEqual(['focus Phone', 'kbShow h=300 ×3']);
  });

  it('starts a new row when the event changes, so a pattern stays visible', () => {
    logEvent('kbShow h=300');
    logEvent('kbShow h=300');
    logEvent('scroll y=170');
    logEvent('kbShow h=300');

    expect(getEvents().map((e) => e.text)).toEqual([
      'kbShow h=300 ×2',
      'scroll y=170',
      'kbShow h=300',
    ]);
  });

  it('keeps only what fits on a phone screen', () => {
    for (let i = 0; i < 40; i += 1) logEvent(`event ${i}`);

    const events = getEvents();
    expect(events).toHaveLength(14);
    // The newest survive: the end of a run is what explains it.
    expect(events[events.length - 1].text).toBe('event 39');
  });
});

/**
 * The overlay draws over the app and prints the label of every field on
 * screen. It is fine in a build made to answer one question and unacceptable
 * in anything a person installs as TuTak, so the gate is tested the same way
 * the demo gate is.
 */
describe('isDiagnosticBuild', () => {
  afterEach(() => setExtra({}));

  it('is on only when the build config says so', () => {
    setExtra({ diagnostics: true });
    expect(isDiagnosticBuild()).toBe(true);
  });

  it.each([
    ['an ordinary preview build', { diagnostics: false }],
    ['a build that never mentions it', {}],
    ['a build with no config at all', null],
    ['a truthy value that is not true', { diagnostics: 'yes' }],
  ])('is off in %s', (_case, extra) => {
    setExtra(extra as Record<string, unknown> | null);
    expect(isDiagnosticBuild()).toBe(false);
  });

  it('names the commit it was built from, shortened', () => {
    setExtra({ commit: '266edc15211cc897a0ea6c5c77981abc10163637' });
    expect(buildCommit()).toBe('266edc1');
  });

  it('says so rather than guessing when the commit is missing', () => {
    setExtra({});
    expect(buildCommit()).toBe('unknown');
  });
});

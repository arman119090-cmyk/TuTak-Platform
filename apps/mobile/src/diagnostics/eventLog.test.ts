import Constants from 'expo-constants';
import {
  TAIL_CAPACITY,
  exportFileName,
  getAllEvents,
  logEvent,
  getEvents,
  resetEvents,
  runId,
  serializeEvents,
} from './eventLog';
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
 * An export is only evidence if the reader can tell it arrived whole.
 *
 * Two exports of run 7FEV1Y reported 319 and then 338 events, and both times
 * the text that arrived stopped at the same character, mid-word. Nothing in
 * the received text said so — a truncated log and a short session looked
 * identical. These pin the two properties that make the difference: every
 * retained row is in the export, and the export says at its own end how many
 * rows it should have.
 */
describe('exporting the log', () => {
  beforeEach(resetEvents);

  it('carries every retained row, not just the ones the panel draws', () => {
    for (let i = 0; i < 120; i += 1) logEvent(`event ${i}`);

    const text = serializeEvents({});
    // The panel shows fourteen; the export is not allowed to inherit that.
    expect(getEvents()).toHaveLength(14);
    expect(getAllEvents()).toHaveLength(120);
    for (let i = 0; i < 120; i += 1) expect(text).toContain(`event ${i}`);
  });

  it('ends with a count a reader can check the received text against', () => {
    for (let i = 0; i < 120; i += 1) logEvent(`event ${i}`);

    const lines = serializeEvents({}).split('\n');
    expect(lines[lines.length - 1]).toBe('END records=120');
    // The count is the number of rows, and the rows are what sits between the
    // blank line under the header and the blank line above END.
    const body = lines.slice(lines.indexOf('') + 1, lines.length - 2);
    expect(body).toHaveLength(120);
  });

  it('names the run and the build in the header and in the file name', () => {
    logEvent('focus Phone');

    expect(serializeEvents({ commit: 'abc1234' })).toContain(`run ${runId()} started `);
    expect(serializeEvents({ commit: 'abc1234' })).toContain('commit abc1234');
    expect(exportFileName('abc1234')).toBe(`tutak-diag-abc1234-${runId()}.txt`);
  });

  /**
   * The short export exists because the long one did not arrive. It has to
   * say that it is short — a fifty-row log and a fifty-row session are
   * different findings, and only the header separates them.
   */
  it('says how much it left out when only the tail is exported', () => {
    for (let i = 0; i < 120; i += 1) logEvent(`event ${i}`);

    const text = serializeEvents({}, { limit: TAIL_CAPACITY });
    expect(text).toContain('events 50 of 120 (last 50 only)');
    expect(text.split('\n').pop()).toBe('END records=50');
    expect(text).toContain('event 119');
    expect(text).toContain('event 70');
    expect(text).not.toContain('event 69');
  });

  it('exports everything when there is less than the tail asks for', () => {
    logEvent('focus Phone');
    logEvent('blur Phone');

    const text = serializeEvents({}, { limit: TAIL_CAPACITY });
    expect(text).toContain('events 2');
    expect(text).not.toContain('of 2');
    expect(text.split('\n').pop()).toBe('END records=2');
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

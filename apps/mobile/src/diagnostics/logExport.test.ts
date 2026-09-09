import { Share } from 'react-native';
import { logEvent, resetEvents } from './eventLog';
import { shareLogFile, shareLogTail, shareLogText } from './logExport';

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { diagnostics: true, commit: 'abc1234def', appEnv: 'staging' } } },
}));

/**
 * A filesystem that records instead of writing.
 *
 * The state lives inside the factory because Jest hoists the mock above
 * everything else in the file; `__written` is how the tests below read it
 * back, and it is the whole reason this is a hand-written mock rather than
 * `jest.fn()`s — what matters is the bytes that reached the file, not that a
 * function was called.
 */
jest.mock('expo-file-system', () => {
  const written: { uri: string; content: string; created: unknown }[] = [];
  class File {
    uri: string;
    constructor(...parts: string[]) {
      this.uri = parts.join('/');
    }
    create(options: unknown) {
      written.push({ uri: this.uri, content: '', created: options });
    }
    write(content: string) {
      const entry = written.find((candidate) => candidate.uri === this.uri);
      if (entry) entry.content = content;
    }
  }
  return { __esModule: true, Paths: { cache: 'file:///cache' }, File, __written: written };
});

jest.mock('expo-sharing', () => ({
  __esModule: true,
  isAvailableAsync: jest.fn(async () => true),
  shareAsync: jest.fn(async () => undefined),
}));

/* eslint-disable @typescript-eslint/no-require-imports */
const { __written: written } = require('expo-file-system') as {
  __written: { uri: string; content: string; created: unknown }[];
};
const Sharing = require('expo-sharing') as { isAvailableAsync: jest.Mock; shareAsync: jest.Mock };
/* eslint-enable @typescript-eslint/no-require-imports */

/**
 * Getting the log off the phone is the part that failed, not the logging.
 *
 * Two exports of run 7FEV1Y reported 319 and then 338 events and both arrived
 * cut at the same character, mid-word. The file path exists to take the
 * receiving app out of the loop. These check the three ways it could fail
 * silently again: the file not getting the whole log, a device without file
 * sharing appearing to have worked, and the short export not being short.
 */
describe('the log export', () => {
  beforeEach(() => {
    resetEvents();
    written.length = 0;
    // `restoreAllMocks` does not reach a `jest.fn()` created inside a module
    // factory, so the call history has to be cleared by hand or one test
    // reads the previous one's calls.
    Sharing.isAvailableAsync.mockClear().mockResolvedValue(true);
    Sharing.shareAsync.mockClear().mockResolvedValue(undefined);
    jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
  });

  afterEach(() => jest.restoreAllMocks());

  it('writes the whole log to a .txt named for the build and the run', async () => {
    for (let i = 0; i < 120; i += 1) logEvent(`event ${i}`);

    await expect(shareLogFile()).resolves.toBe('shared');

    expect(written).toHaveLength(1);
    const [file] = written;
    expect(file.uri).toMatch(/^file:\/\/\/cache\/tutak-diag-abc1234-[A-Z0-9]{6}\.txt$/);
    // Overwriting rather than accumulating: several exports within one run
    // are the same file, and a stale one must not be shared by mistake.
    expect(file.created).toEqual({ overwrite: true, intermediates: true });
    for (let i = 0; i < 120; i += 1) expect(file.content).toContain(`event ${i}`);
    expect(file.content.split('\n').pop()).toBe('END records=120');
    // Provenance, so two exports can be told apart without asking.
    expect(file.content).toContain('commit abc1234');
    expect(file.content).toContain('profile staging');
    expect(file.content).toContain('experiment SCF=off RR=on');

    expect(Sharing.shareAsync).toHaveBeenCalledWith(
      file.uri,
      expect.objectContaining({ mimeType: 'text/plain' }),
    );
  });

  it('reports a device that cannot share files rather than looking successful', async () => {
    Sharing.isAvailableAsync.mockResolvedValue(false);
    logEvent('focus Phone');

    await expect(shareLogFile()).resolves.toBe('unavailable');
    expect(written).toHaveLength(0);
    expect(Sharing.shareAsync).not.toHaveBeenCalled();
  });

  it('reports a share that threw rather than swallowing it', async () => {
    Sharing.shareAsync.mockRejectedValue(new Error('no activity found'));
    logEvent('focus Phone');

    await expect(shareLogFile()).resolves.toBe('failed');
  });

  it('sends only the last fifty rows as a message, and says so', async () => {
    for (let i = 0; i < 120; i += 1) logEvent(`event ${i}`);

    await expect(shareLogTail()).resolves.toBe('shared');

    const { message } = (Share.share as jest.Mock).mock.calls[0][0] as { message: string };
    expect(message).toContain('events 50 of 120 (last 50 only)');
    expect(message).toContain('event 119');
    expect(message).not.toContain('event 69');
    expect(message.split('\n').pop()).toBe('END records=50');
    // The file is untouched: this path exists for when the file path is not
    // available at all.
    expect(written).toHaveLength(0);
  });

  it('still offers the whole log as a message, which is what the file replaced', async () => {
    for (let i = 0; i < 120; i += 1) logEvent(`event ${i}`);

    await expect(shareLogText()).resolves.toBe('shared');

    const { message } = (Share.share as jest.Mock).mock.calls[0][0] as { message: string };
    expect(message).toContain('events 120');
    expect(message.split('\n').pop()).toBe('END records=120');
  });
});

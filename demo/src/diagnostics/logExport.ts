import { Dimensions, Share } from 'react-native';
import Constants from 'expo-constants';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { TAIL_CAPACITY, exportFileName, serializeEvents } from './eventLog';
import { buildCommit } from './isDiagnosticBuild';
import { traceSummary } from './instanceTrace';
import { experimentLabel } from './experiment';

/**
 * Getting the log off the phone, in the three shapes it has had to take.
 *
 * ## Why this is not one button any more
 *
 * The first transport was a photograph of the panel. The second was
 * `Share.share({ message })`, which hands the whole log to whichever app the
 * operator picks. That worked until the log got long: run `7FEV1Y` exported
 * 319 events and then 338, and both times the text that arrived at the other
 * end stopped at the same character, in the middle of a word, with no marker
 * saying it had been cut. A message that long is at the mercy of the app
 * carrying it, and the part that mattered — what happened after the
 * experiment arm was flipped — was in the half that never arrived.
 *
 * So there are now three, and they fail differently on purpose:
 *
 * - **a file.** The log is written to the cache as `.txt` and handed to the
 *   share sheet as a file. Nothing in the middle re-flows or clips it, and
 *   what lands on the other end is byte-for-byte what was written.
 * - **the last fifty rows as text.** Short enough to survive any transport,
 *   including being read off a photograph, for when the question is about one
 *   interaction rather than a whole session.
 * - **the whole log as text**, which is what existed before. Kept because
 *   `Sharing` is a native module and a device may report it unavailable, and
 *   a diagnostic build with no way at all to speak is worth nothing.
 *
 * Every one of them ends in `END records=N`, so a truncated arrival is
 * visible as such rather than mistaken for a short session.
 *
 * ## What it must never carry
 *
 * The same rule as the log itself: labels, ids, counts and sizes. Nothing
 * here reads a field's value, and the header below is the only thing this
 * module adds to what `serializeEvents` already produced.
 */

/**
 * Provenance for the export: which build, which environment, which arms.
 *
 * Deliberately gathered here rather than in the overlay, so all three
 * transports carry an identical header and two exports can be compared line
 * by line.
 */
export function exportHeader(): Record<string, string> {
  const { width, height } = Dimensions.get('window');
  const screen = Dimensions.get('screen');
  return {
    commit: buildCommit(),
    profile: String(Constants.expoConfig?.extra?.appEnv ?? 'unknown'),
    api: apiHost(),
    trace: traceSummary(),
    experiment: experimentLabel(),
    window: `${Math.round(width)}x${Math.round(height)}`,
    screen: `${Math.round(screen.width)}x${Math.round(screen.height)}`,
  };
}

/**
 * Which server this build talks to, as a bare hostname.
 *
 * Added because working it out cost a round trip: the API address is baked in
 * at build time and shown nowhere, so the only way to answer "which
 * environment was this log taken against" was to unzip the APK and read
 * `assets/app.config`. Two environments were in play at the time and the
 * answer mattered — a finding about one of them says nothing about the other,
 * because each picks its own SMS transport from its own variables.
 *
 * Host only: the path and any query are dropped. There is nothing secret in a
 * hostname, and dropping the rest keeps a credential out of the log if one is
 * ever put in a URL by mistake.
 */
function apiHost(): string {
  const configured = Constants.expoConfig?.extra?.apiBaseUrl;
  if (typeof configured !== 'string' || configured === '') return 'unknown';
  return /^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i.exec(configured)?.[1] ?? configured;
}

/**
 * How an export ended, for the button to show.
 *
 * A share sheet that never opened and a share sheet the operator dismissed
 * look identical from here, and neither is worth an alert over the screen
 * being diagnosed — but "the file button does nothing" has already cost one
 * round trip, so the button reports for itself.
 */
export type ExportOutcome = 'shared' | 'unavailable' | 'failed';

/** The whole log as text, through the phone's share sheet. The original path. */
export async function shareLogText(): Promise<ExportOutcome> {
  return shareText(serializeEvents(exportHeader()));
}

/** The last {@link TAIL_CAPACITY} rows, short enough to survive any transport. */
export async function shareLogTail(): Promise<ExportOutcome> {
  return shareText(serializeEvents(exportHeader(), { limit: TAIL_CAPACITY }));
}

async function shareText(message: string): Promise<ExportOutcome> {
  try {
    await Share.share({ message });
    return 'shared';
  } catch {
    // A share sheet the user dismissed, or a device with nothing to share
    // to. Neither is worth an alert on top of the screen being diagnosed.
    return 'failed';
  }
}

/**
 * The whole log as a `.txt` file, through the phone's share sheet.
 *
 * Written into the cache rather than documents: it is a copy of something the
 * app is already holding, and the system may reclaim it the moment it is no
 * longer interesting. The name carries the build and the run id so several
 * exports sitting in a chat are still telling apart, and it is stable within
 * a run so repeated exports overwrite rather than accumulate.
 *
 * `Share.share({ url })` is not the path here: on Android React Native's own
 * share only sends `message`, so a file needs `expo-sharing`, which puts the
 * file behind a content URI the receiving app can actually read.
 */
export async function shareLogFile(): Promise<ExportOutcome> {
  try {
    if (!(await Sharing.isAvailableAsync())) return 'unavailable';

    const file = new File(Paths.cache, exportFileName(buildCommit()));
    file.create({ overwrite: true, intermediates: true });
    file.write(serializeEvents(exportHeader()));

    await Sharing.shareAsync(file.uri, {
      mimeType: 'text/plain',
      UTI: 'public.plain-text',
      dialogTitle: 'TuTak diagnostic log',
    });
    return 'shared';
  } catch {
    return 'failed';
  }
}

import Constants from 'expo-constants';

/**
 * Whether this build carries the on-screen event log.
 *
 * Read from `extra.diagnostics`, which only the `diagnostic` EAS profile sets
 * (see `eas.json`). Deliberately not `__DEV__`: a development build pointed at
 * a real API is a normal build, and the overlay covers part of the screen —
 * it belongs in a build made to answer one question, and nowhere else.
 *
 * The same shape as `mockGate.ts` for the same reason: a diagnostic surface is
 * something a release must be structurally incapable of, not something a
 * release happens not to have.
 */
export function isDiagnosticBuild(): boolean {
  return Constants.expoConfig?.extra?.diagnostics === true;
}

/**
 * The commit this build came from, shown on screen.
 *
 * There is no more expensive question in this whole episode than "which
 * version is on the phone". A whole test cycle was nearly spent on it, and the
 * only reason it was not is that the answer happened to be the right one. A
 * build that states its own commit cannot be confused with the build before
 * it.
 */
export function buildCommit(): string {
  const commit = Constants.expoConfig?.extra?.commit;
  return typeof commit === 'string' && commit.length > 0 ? commit.slice(0, 7) : 'unknown';
}

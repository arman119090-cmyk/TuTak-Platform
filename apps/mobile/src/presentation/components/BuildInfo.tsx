import React from 'react';
import { Text } from 'react-native';
import Constants from 'expo-constants';
import { useTheme } from '../../app/theme/ThemeProvider';

/**
 * What this install actually is, on the one screen a tester will look for it.
 *
 * `app.config.js` names a staging build "TuTak (staging)" precisely because
 * the icon label was, in its own words, "the only reliably visible signal of
 * which server a given install talks to — there is no in-app 'about' screen
 * showing the build's environment today". This is that screen.
 *
 * It exists because of how the last round of this went: the expensive
 * question was never "what does it look like", it was "which build is on the
 * phone and what is it talking to". A screenshot that answers both turns "the
 * app doesn't work" into a report someone can act on.
 *
 * Nothing here is a secret. The API host is a public address the app makes
 * requests to over the network; the commit is already carried in `extra` for
 * Sentry's release tag. A production build shows neither — it shows what it
 * always showed — because by then the answer is not in question and the space
 * belongs to the customer.
 */
export function buildInfoLine(
  extra: Record<string, unknown> | undefined,
  version: string | undefined,
): string {
  const name = `TuTak · v${version ?? '0.1.0'}`;
  const appEnv = typeof extra?.appEnv === 'string' ? extra.appEnv : '';
  if (appEnv === 'production' || appEnv === '') return name;

  const parts = [name, appEnv];

  // The host only — not the path, and never any query. A base URL is
  // `https://host/v1`, and the host is the part that answers "is this
  // pointing where I think it is".
  const apiBaseUrl = typeof extra?.apiBaseUrl === 'string' ? extra.apiBaseUrl : '';
  const host = apiBaseUrl.replace(/^https?:\/\//, '').split('/')[0];
  if (host) parts.push(host);

  // Short, because the whole value is unreadable on a phone and the first
  // seven characters already identify the commit.
  const commit = typeof extra?.commit === 'string' ? extra.commit : '';
  if (commit) parts.push(commit.slice(0, 7));

  return parts.join(' · ');
}

export function BuildInfo() {
  const { color, space, text } = useTheme();

  return (
    <Text
      // Selectable so a tester can copy the commit into a message rather
      // than transcribing it from a photograph of a screen.
      selectable
      style={[
        text.caption,
        { color: color.textTertiary, textAlign: 'center', marginTop: space[6] },
      ]}
    >
      {buildInfoLine(
        Constants.expoConfig?.extra as Record<string, unknown> | undefined,
        Constants.expoConfig?.version,
      )}
    </Text>
  );
}

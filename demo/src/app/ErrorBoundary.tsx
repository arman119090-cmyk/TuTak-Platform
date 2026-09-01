import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import * as Sentry from '@sentry/react-native';

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
  info: string | null;
}

/**
 * Puts the error on the screen instead of leaving a flicker.
 *
 * A release build has no console anybody can read. When something throws
 * during render, React unmounts the tree and the app shows — depending on
 * where it happened — a blank screen, a redraw loop, or a phone that appears
 * to be doing nothing. All of that reaches me as "it glitches", which is
 * true and unactionable, and it cost two wrong guesses before this file
 * existed.
 *
 * So the error is rendered. Plainly, in a scroll view, in a size that can be
 * photographed. Whoever is holding the phone can send a picture and the next
 * step stops being a guess.
 *
 * Deliberately not styled with the design system: this has to work when the
 * theme provider is the thing that broke.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    this.setState({ info: info.componentStack ?? null });
    // Still logged, for the cases where somebody does have a cable.
    console.error('Unhandled error in the app tree', error);
    // A no-op when no DSN is configured (see app/sentry.ts) — this UI and
    // the console line above are unchanged either way.
    Sentry.withScope((scope) => {
      scope.setTag('service', 'mobile');
      scope.setTag('boundary', 'root');
      if (info.componentStack) scope.setExtra('componentStack', info.componentStack);
      Sentry.captureException(error);
    });
  }

  render() {
    const { error, info } = this.state;
    if (!error) return this.props.children;

    return (
      <View style={styles.screen}>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.title}>TuTak could not start</Text>
          <Text style={styles.hint}>
            Please send a photograph of this screen — everything below is what went wrong.
          </Text>

          <Text style={styles.label}>Error</Text>
          <Text style={styles.body} selectable>
            {error.name}: {error.message}
          </Text>

          {error.stack ? (
            <>
              <Text style={styles.label}>Where</Text>
              <Text style={styles.mono} selectable>
                {error.stack.split('\n').slice(0, 12).join('\n')}
              </Text>
            </>
          ) : null}

          {info ? (
            <>
              <Text style={styles.label}>Component</Text>
              <Text style={styles.mono} selectable>
                {info.split('\n').slice(0, 12).join('\n')}
              </Text>
            </>
          ) : null}
        </ScrollView>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0A0A0F' },
  content: { padding: 20, paddingTop: 64 },
  title: { color: '#FFFFFF', fontSize: 20, fontWeight: '600' },
  hint: { color: '#9CA3AF', fontSize: 14, marginTop: 8, marginBottom: 20 },
  label: { color: '#6B7280', fontSize: 12, marginTop: 20, marginBottom: 6 },
  body: { color: '#FCA5A5', fontSize: 15 },
  mono: { color: '#D1D5DB', fontSize: 11, fontFamily: 'monospace' },
});

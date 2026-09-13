import 'react-native-gesture-handler';
import React, { useEffect, useMemo, useState } from 'react';
import { NavigationContainer, DarkTheme, DefaultTheme } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClientProvider } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import { I18nextProvider } from 'react-i18next';

import { ErrorBoundary } from './src/app/ErrorBoundary';
import i18n from './src/app/i18n/i18n';
// Side-effect import: subscribes the interface language to the session, so it
// follows the account rather than staying wherever the last person on this
// handset left it. Module scope for the same reason as the query cache below.
import './src/app/i18n/sessionLocale';
import { ThemeProvider, useTheme } from './src/app/theme/ThemeProvider';
import { AuthNavigator } from './src/app/navigation/AuthNavigator';
import { RootNavigator } from './src/app/navigation/RootNavigator';
import { SplashScreen } from './src/presentation/screens/SplashScreen';
import { useAuthStore } from './src/data/stores/authStore';
import { usePushRegistration } from './src/app/usePushRegistration';
import { DiagnosticOverlay } from './src/diagnostics/DiagnosticOverlay';
import { useMountTrace } from './src/diagnostics/instanceTrace';
import { useAppStateTrace } from './src/diagnostics/useAppStateTrace';
import { installFocusCommandTrace } from './src/diagnostics/focusCommandTrace';
import { useNativeFocusTrace } from './src/diagnostics/nativeFocusTrace';
import { OfflineBanner } from './src/presentation/components/OfflineBanner';
import { startNetworkStateTracking } from './src/data/network/networkState';

// The client and its retry policy live in `src/data/queryClient.ts`, together
// with the subscription that empties the cache when the session changes —
// that subscription has to be established once, at module scope, not by a
// component the sign-out it watches for could unmount.
import { queryClient } from './src/data/queryClient';

function Root() {
  const theme = useTheme();
  const { user, hydrate } = useAuthStore();
  const [ready, setReady] = useState(false);

  /*
   * The reference mark every other mount line is read against.
   *
   * A screen mounting twice can mean the screen was rebuilt or that
   * everything was — and the difference decides whether the answer is in this
   * codebase or in the Android configuration. This is the root of the React
   * tree, so a second `mount App` in one run means the whole surface
   * restarted; a second `mount OtpRegister` with `mount App #1` still
   * standing above it means only the screen did. Neither reading is available
   * from a screen's own log line, which is why the previous round could not
   * make it and inferred an activity restart it had no evidence for.
   *
   * `useAppStateTrace` is the third signal: an activity that is being
   * recreated does not stay `active` throughout, and a keyboard appearing on
   * an app that keeps running does.
   */
  useMountTrace('App');
  /*
   * What this line does and does not mean — stated here because it has
   * already been over-read once.
   *
   * `useMountTrace` sits in `Root`, which is a React component nested inside
   * `ErrorBoundary → SafeAreaProvider → I18nextProvider → QueryClientProvider
   * → ThemeProvider`. So `mount App #n` records that **this React component**
   * mounted, and nothing more.
   *
   * `unmount App @1` followed by `mount App #2 @2` under the *same* run id
   * therefore means exactly this: the React tree below here was torn down and
   * rebuilt while the JavaScript context survived. That is **consistent
   * with** the activity being recreated and the React Native surface
   * restarting — and it is not proof of it. Anything above `Root` that
   * changed its identity would produce the same two lines, and so would a
   * surface restart with no activity involved.
   *
   * What would distinguish them is not available from JavaScript. It needs a
   * native trace — `adb logcat` showing the activity lifecycle — and until
   * that exists these lines say "the React root was replaced", full stop.
   */
  useAppStateTrace();

  /*
   * Armed before anything can be focused, and only in a diagnostic build.
   *
   * The device log shows focus moving between two fields in twenty
   * milliseconds, several times, which nobody's thumb did. What it cannot
   * show is whether some JavaScript asked for that or whether Android moved
   * it and React Native merely reported it — the two have different fixes,
   * and `onFocus` looks identical either way. See `focusCommandTrace.ts`.
   */
  installFocusCommandTrace();

  /*
   * The Android-side observers, drained into the same log.
   *
   * Everything reachable from JavaScript has been spent: the focus commands
   * are wrapped and stay silent, the mount counters hold, the window never
   * moves, and `scrollsChildToFocus` changed nothing across eight attempts.
   * What is left is the Java stack at the moment the focus moves, and it
   * exists only on the native side. See `modules/focus-trace` for what the
   * three observers do and do not cover.
   */
  useNativeFocusTrace();

  /**
   * Navigation's own chrome recoloured to the active TuTak palette.
   *
   * Built on `DarkTheme`/`DefaultTheme` matching `theme.mode` rather than
   * always `DarkTheme`, because the base theme is what shows through in the
   * places this object does not reach — the push and pop transition underlay
   * between two screens, most visibly. Picking the wrong base flashes the
   * *other* theme's ground colour on every navigation.
   */
  const navigationTheme = useMemo(() => {
    const base = theme.mode === 'dark' ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        primary: theme.color.primary,
        background: theme.color.background,
        card: theme.color.background,
        text: theme.color.textPrimary,
        border: theme.color.border,
      },
    };
  }, [theme]);

  useEffect(() => {
    // This is the only gate between the splash screen and the app, so it has
    // to open however hydration turns out. A rejected promise here shows the
    // logo forever, with no error and no way out — the failure the browser
    // build shipped with once already. The store is written so it cannot
    // reject; this does not rely on that staying true.
    //
    // The `catch` is what makes it safe, not the ordering: `finally` alone
    // passes the rejection along to nobody, which is an unhandled rejection
    // and a red box on top of an app that did start.
    hydrate()
      .catch(() => undefined)
      .then(() => setReady(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Asks for notification permission once a session exists — after someone
  // has signed in and seen what the app does, which is when a prompt has a
  // chance of being allowed.
  usePushRegistration();

  // One subscription for the whole app: it drives both the banner below and
  // TanStack Query's own online state, so a paused query and the message on
  // screen cannot contradict each other. Stopped on unmount — an app-level
  // listener that outlives the app is exactly the kind of handle that only
  // surfaces as a stuck test run.
  useEffect(() => startNetworkStateTracking(), []);

  // One latch, not two. This used to also require the store's `isHydrated`,
  // which is only raised on the success path — so any failure inside
  // hydration left both flags disagreeing and the splash screen up. `ready`
  // means "hydration has settled", which is the actual question being asked
  // here, and it is answered whichever way hydration went.
  if (!ready) {
    return <SplashScreen />;
  }

  return (
    <NavigationContainer theme={navigationTheme}>
      {/* Light content (white icons/clock) reads on the dark ground; dark
          content is what the light theme's white ground needs instead — a
          fixed "light" style here left the status bar unreadable against a
          white screen. */}
      <StatusBar style={theme.mode === 'dark' ? 'light' : 'dark'} />
      {user ? <RootNavigator /> : <AuthNavigator />}
      {/*
        Inside the navigator so it sits over whatever screen is showing, and
        last so nothing paints over it. Renders `null` in every build except
        the `diagnostic` profile — see `isDiagnosticBuild`.
      */}
      {/* Above the navigator and below the diagnostic overlay: it must be
          visible on every screen without taking the screen away. */}
      <OfflineBanner />
      <DiagnosticOverlay />
    </NavigationContainer>
  );
}

export default function App() {
  return (
    // Outermost on purpose: a failure anywhere below — the theme, i18n, the
    // navigator, a screen — becomes a readable message rather than a blank
    // screen or a redraw nobody can diagnose from a photograph.
    <ErrorBoundary>
      <SafeAreaProvider>
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider>
            <Root />
          </ThemeProvider>
        </QueryClientProvider>
        </I18nextProvider>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}

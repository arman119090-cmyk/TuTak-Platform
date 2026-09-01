import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useIsOffline } from '../../data/network/networkState';
import { useTheme } from '../../app/theme/ThemeProvider';

/**
 * One place that says "you are offline", instead of every screen inventing its
 * own version of "something went wrong".
 *
 * It is deliberately not blocking: the app keeps whatever it already loaded on
 * screen and stays navigable, because a cached balance is more useful than a
 * modal. TanStack Query pauses its own fetches through the same signal
 * (`networkState.ts` drives `onlineManager`), so what the banner says and what
 * the data layer does cannot disagree.
 */
export function OfflineBanner(): React.ReactElement | null {
  const isOffline = useIsOffline();
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  if (!isOffline) return null;

  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      testID="offline-banner"
      style={[
        styles.container,
        { paddingTop: insets.top + 8, backgroundColor: theme.color.dangerFill },
      ]}
    >
      <Text style={[styles.title, { color: theme.color.textInverse }]}>
        {t('common.offlineTitle')}
      </Text>
      <Text style={[styles.body, { color: theme.color.textInverse }]}>
        {t('common.offlineBody')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingBottom: 8,
    zIndex: 1000,
  },
  title: { fontSize: 14, fontWeight: '600' },
  body: { fontSize: 12, marginTop: 2 },
});

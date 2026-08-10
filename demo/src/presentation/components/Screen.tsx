import React from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../../app/theme/ThemeProvider';
import { KeyboardAwareScroll } from './KeyboardAwareScroll';

interface Props {
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
  scroll?: boolean;
  /** Rendered flush to the right of the title, e.g. an action or avatar. */
  headerAccessory?: React.ReactNode;
  contentStyle?: ViewStyle;
  /** Content that should sit outside the horizontal gutter (edge-to-edge). */
  bleed?: React.ReactNode;
}

/**
 * Every screen in the app is built from this, which is what makes the
 * product feel like one thing: identical gutters, identical title
 * treatment, identical scroll behaviour, everywhere.
 */
export function Screen({
  children,
  title,
  subtitle,
  scroll = true,
  headerAccessory,
  contentStyle,
  bleed,
}: Props) {
  const { color, space, text, layout } = useTheme();

  // A scrolling screen gets the app's keyboard behaviour for free — several
  // settings screens used to wrap this component in a `KeyboardAvoidingView`
  // of their own, each one repeating the same Android mistake.
  const body = (
    <>
        {title ? (
          <View
            style={[
              styles.header,
              { paddingHorizontal: layout.screenPaddingX, paddingTop: space[4], paddingBottom: space[5] },
            ]}
          >
            <View style={styles.flex}>
              <Text style={[text.titleLg, { color: color.textPrimary }]}>{title}</Text>
              {subtitle ? (
                <Text style={[text.bodySm, { color: color.textSecondary, marginTop: space[1] }]}>
                  {subtitle}
                </Text>
              ) : null}
            </View>
            {headerAccessory}
          </View>
        ) : null}

        {bleed}

        <View
          style={[
            { paddingHorizontal: layout.screenPaddingX },
            !scroll && styles.flex,
            contentStyle,
          ]}
        >
          {children}
        </View>
    </>
  );

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: color.background }]} edges={['top']}>
      {scroll ? (
        <KeyboardAwareScroll contentContainerStyle={{ paddingBottom: layout.tabBarHeight }}>
          {body}
        </KeyboardAwareScroll>
      ) : (
        <View style={styles.flex}>{body}</View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'flex-start' },
});

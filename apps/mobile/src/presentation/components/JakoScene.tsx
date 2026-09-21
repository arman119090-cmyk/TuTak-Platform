import React from 'react';
import { Image as RNImage, Pressable, StyleSheet, Text, View, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView, useSafeAreaInsets, type EdgeInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, type NavigationProp, type ParamListBase } from '@react-navigation/native';
import Svg, { Path } from 'react-native-svg';
import { useTheme } from '../../app/theme/ThemeProvider';
import { KeyboardAwareScroll } from './KeyboardAwareScroll';
import { useCompactLayout } from './useCompactLayout';
import { jakoAsset, type JakoState } from './JakoHero';
import { Handwritten } from './Handwritten';

/* eslint-disable @typescript-eslint/no-require-imports */
const BOKEH = {
  light: require('../../../assets/scene/bokeh-light.webp'),
  dark: require('../../../assets/scene/bokeh-dark.webp'),
};
const LOGO_MARK = require('../../../assets/logo-mark.png');
/* eslint-enable @typescript-eslint/no-require-imports */

/** Radius of the sheet's top corners, and how far it rises over the stage. */
const SHEET_RADIUS = 28;
/** How far Jako's feet reach down past the sheet's top edge — he stands on it. */
const FEET_OVER_EDGE = 14;

export type JakoSceneSize = 'hero' | 'compact';

/**
 * Height of the zone Jako stands in, in points, below the words and above
 * the sheet. `hero` is the auth and partner screens; `compact` a screen
 * whose own content must stay above the fold — the lock screen's keypad,
 * a status. A short phone (`useCompactLayout`) gets the smaller value of
 * each pair; the keyboard never changes either (see `JakoHero.tsx`).
 *
 * The words above the zone take whatever height their language needs, so
 * the stage as a whole is as tall as the text plus this. Nothing here is
 * measured: it is ordinary flex layout, decided once per render.
 */
const ZONE: Record<JakoSceneSize, { regular: number; compact: number }> = {
  hero: { regular: 216, compact: 176 },
  compact: { regular: 136, compact: 112 },
};

interface Props {
  state: JakoState;
  title: string;
  subtitle?: string;
  /** A line in the brand's handwriting under the title. */
  note?: string;
  /** What Jako says, in a small bubble beside him. */
  bubble?: string;
  size?: JakoSceneSize;
  /**
   * The sheet scrolls by default, with the app's keyboard behaviour. A
   * screen that lays itself out against the bottom of the window (the lock
   * screen and its keypad) passes `false` and gets a plain flex sheet.
   */
  scroll?: boolean;
  /** Show the mark and the name at the top of the stage. */
  logo?: boolean;
  children: React.ReactNode;
  sheetStyle?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * A screen with Jako on it, the way the owner's reference has him: a soft
 * green ground, the title at the left, the bird large at the right with his
 * feet on the edge of a white sheet that carries the form, a line of
 * handwriting beside him and a small bubble of what he says.
 *
 * One component draws every such screen — login, code, password, the
 * partner application, the lock screen — so the stage is the same height,
 * the bird the same size and the sheet the same radius everywhere, which is
 * what makes fourteen pictures read as one character on one product.
 *
 * ## Where the sheet's content lives
 *
 * Inside the same `KeyboardAwareScroll` the auth screens have always used:
 * the stage is simply the first thing in the scroll, so when a field is
 * brought above the keyboard the stage scrolls away and nothing is laid out
 * differently. No measurement of the stage feeds back into layout, and no
 * keyboard event changes any height here — the two rules that keep the
 * Android focus incident (`useCompactLayout.ts`, `KeyboardAwareScroll.tsx`)
 * closed.
 *
 * ## Draw order
 *
 * Bird above sheet: the stage is drawn after the sheet in z (`zIndex`), and
 * the sheet has no elevation of its own, so Android's elevation ordering
 * cannot put the sheet back on top. The stage is `box-none` so the strip
 * where it overhangs the sheet passes touches through to the fields.
 */
export function JakoScene({
  state,
  title,
  subtitle,
  note,
  bubble,
  size = 'hero',
  scroll = true,
  logo = true,
  children,
  sheetStyle,
  testID,
}: Props) {
  const { color, space, text, layout, premium, mode } = useTheme();
  const navigation = useOptionalNavigation();
  const insets = useOptionalInsets();
  const compact = useCompactLayout();
  // Width, not height: the keyboard changes a window's height, never its
  // width, so this cannot flip during an interaction. A 360pt phone gets a
  // title two points smaller so «Восстановление» stays one word.
  const narrow = useWindowDimensions().width < 380;

  const zone = compact ? ZONE[size].compact : ZONE[size].regular;
  // Exactly as tall as the zone plus the feet's reach over the sheet's edge:
  // the top of his frame is the top of the zone, so he never rises into the
  // words. The words are never on him; that is the whole layout.
  const figure = zone + (SHEET_RADIUS - FEET_OVER_EDGE);
  const canGoBack = navigation?.canGoBack() ?? false;
  const dark = mode === 'dark';
  // The handwriting: the deep brand green on the light ground, the light
  // one on ink. The mid green disappeared into the bokeh.
  const ink = dark ? premium.brand.light : premium.brand.dark;
  const bubbleFill = dark ? 'rgba(52, 199, 89, 0.16)' : 'rgba(31, 122, 76, 0.10)';
  const buttonFill = dark ? 'rgba(255, 255, 255, 0.10)' : 'rgba(255, 255, 255, 0.86)';
  // A faint halo the colour of the ground, so a long title or subtitle
  // stays readable where it runs over a wing. Not a drop shadow: no offset.
  const legible = {
    textShadowColor: dark ? 'rgba(8, 12, 11, 0.85)' : 'rgba(255, 255, 255, 0.9)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 10,
  };

  const stage = (
    <View
      style={[styles.stage, { paddingTop: insets.top }]}
      pointerEvents="box-none"
      testID={testID ?? `scene-${state}`}
    >
      {/* The ground: a still image, never a live blur. A real-time blur on
          Android is a frame budget spent on decoration, and it flickers on
          the handsets this app is checked on. */}
      <Image
        source={dark ? BOKEH.dark : BOKEH.light}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        transition={0}
        accessibilityIgnoresInvertColors
      />

      <View style={[styles.topRow, { paddingHorizontal: layout.screenPaddingX, paddingTop: space[2] }]} pointerEvents="box-none">
        {canGoBack ? (
          <Pressable
            onPress={() => navigation?.goBack()}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Back"
            style={({ pressed }) => [styles.round, { backgroundColor: buttonFill, opacity: pressed ? 0.7 : 1 }]}
          >
            <Ionicons name="arrow-back" size={20} color={color.textPrimary} />
          </Pressable>
        ) : (
          <View style={styles.round} />
        )}
        {logo ? (
          <View style={[styles.logo, { gap: space[2] }]} accessible accessibilityRole="header" accessibilityLabel="TuTak" pointerEvents="none">
            <RNImage source={LOGO_MARK} style={styles.mark} resizeMode="contain" accessibilityIgnoresInvertColors />
            <Text style={[text.title, styles.wordmark, { color: color.textPrimary }]}>TuTak</Text>
          </View>
        ) : null}
      </View>

      <View style={[styles.words, { paddingHorizontal: layout.screenPaddingX, marginTop: space[3] }]} pointerEvents="box-none">
        <Text accessibilityRole="header" style={[size === 'hero' ? text.titleLg : text.title, styles.title, narrow && size === 'hero' ? styles.titleNarrow : null, { color: color.textPrimary }, legible]}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={[text.bodySm, { color: color.textSecondary, marginTop: space[2] }, legible]}>{subtitle}</Text>
        ) : null}
      </View>

      {/* Jako's zone: he stands at the right, the note sits in the free
          ground to his left. Neither is under the other. */}
      <View style={[styles.zone, { height: zone, marginTop: space[3] }]} pointerEvents="none">
        <View
          style={[styles.figure, { width: figure, height: figure, right: -Math.round(figure * 0.05), bottom: -(SHEET_RADIUS - FEET_OVER_EDGE) }]}
          accessible={false}
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
        >
          <Image source={jakoAsset(state)} style={styles.figureImage} contentFit="contain" transition={0} accessibilityIgnoresInvertColors />
        </View>
        {note ? (
          // Clear of the whole frame, wings included: on a narrow phone the
          // note wraps to two lines rather than touch a feather.
          <View style={[styles.noteZone, { left: layout.screenPaddingX, right: Math.round(figure * 0.96) }]}>
            <View style={styles.noteWrap}>
              <Handwritten size={size === 'hero' ? 26 : 22} color={ink} testID="scene-note">
                {note}
              </Handwritten>
              <Svg width={72} height={10} viewBox="0 0 72 10" style={styles.underline}>
                <Path d="M2 7 C 18 2, 40 2, 70 6" stroke={ink} strokeWidth={2} strokeLinecap="round" fill="none" />
              </Svg>
            </View>
          </View>
        ) : null}
      </View>

      {bubble ? (
        <View
          pointerEvents="none"
          style={[
            styles.bubble,
            { top: insets.top + space[2] + 4, right: layout.screenPaddingX, backgroundColor: bubbleFill, paddingHorizontal: space[3], paddingVertical: space[1] },
          ]}
        >
          <Handwritten size={16} color={ink} style={styles.bubbleText} testID="scene-bubble">
            {bubble}
          </Handwritten>
          <Svg width={22} height={22} viewBox="0 0 22 22" style={styles.sparkle}>
            <Path d="M4 4 L9 11 M13 3 L15 9 M2 12 L8 14" stroke={premium.brand.primary} strokeWidth={2} strokeLinecap="round" />
          </Svg>
        </View>
      ) : null}
    </View>
  );

  const sheet = (
    <View
      style={[
        styles.sheet,
        {
          backgroundColor: color.surface,
          paddingHorizontal: layout.screenPaddingX,
          paddingTop: space[7],
          paddingBottom: insets.bottom + space[8],
        },
        sheetStyle,
      ]}
    >
      {children}
    </View>
  );

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: color.surface }]} edges={[]}>
      {scroll ? (
        <KeyboardAwareScroll contentContainerStyle={styles.content}>
          {stage}
          {sheet}
        </KeyboardAwareScroll>
      ) : (
        <View style={styles.flex}>
          {stage}
          {sheet}
        </View>
      )}
    </SafeAreaView>
  );
}

/**
 * `useNavigation` and `useSafeAreaInsets` both throw when their provider is
 * absent, and a screen test renders one screen with neither a navigator nor
 * a safe-area provider around it. Outside them there is nothing to go back
 * to and no inset, which is exactly what is drawn. The hooks are still
 * called unconditionally, so the hook order is stable.
 */
function useOptionalNavigation(): NavigationProp<ParamListBase> | undefined {
  try {
    return useNavigation();
  } catch {
    return undefined;
  }
}

const NO_INSETS: EdgeInsets = { top: 0, bottom: 0, left: 0, right: 0 };

function useOptionalInsets(): EdgeInsets {
  try {
    return useSafeAreaInsets();
  } catch {
    return NO_INSETS;
  }
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { flexGrow: 1 },
  stage: { zIndex: 2, overflow: 'visible' },
  topRow: { flexDirection: 'row', alignItems: 'center', height: 56 },
  round: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  logo: { position: 'absolute', left: 0, right: 0, top: 8, height: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  mark: { width: 26, height: 26 },
  wordmark: { fontWeight: '800', letterSpacing: -0.4 },
  // Room on the right for the bubble's tail to breathe; the title wraps by
  // word inside it and is never under the bird, which sits lower.
  words: { paddingRight: '8%' },
  title: { fontWeight: '800' },
  titleNarrow: { fontSize: 26, lineHeight: 32 },
  zone: { overflow: 'visible' },
  noteZone: { position: 'absolute', top: 0, bottom: 0, justifyContent: 'center' },
  noteWrap: { alignSelf: 'flex-start', transform: [{ rotate: '-4deg' }], paddingRight: 8 },
  underline: { marginTop: -2, marginLeft: 6 },
  figure: { position: 'absolute' },
  figureImage: { width: '100%', height: '100%' },
  bubble: { position: 'absolute', zIndex: 1, borderRadius: 16, borderBottomLeftRadius: 4, maxWidth: '30%' },
  bubbleText: { textAlign: 'center' },
  sparkle: { position: 'absolute', bottom: -18, left: -16 },
  sheet: {
    flex: 1,
    marginTop: -SHEET_RADIUS,
    borderTopLeftRadius: SHEET_RADIUS,
    borderTopRightRadius: SHEET_RADIUS,
  },
});

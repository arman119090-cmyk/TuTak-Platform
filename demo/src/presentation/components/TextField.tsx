import React, { useEffect, useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  findNodeHandle,
} from 'react-native';
import { EyeIcon } from './EyeIcon';
import { useTheme } from '../../app/theme/ThemeProvider';
import { useEnsureVisibleOnFocus } from './KeyboardAwareScroll';
import { logEvent } from '../../diagnostics/eventLog';
import { useMountTrace } from '../../diagnostics/instanceTrace';
import { registerInput } from '../../diagnostics/focusRegistry';
import { logNativeShape } from '../../diagnostics/nativeFocusTrace';
import { useFocusRerender } from '../../diagnostics/experiment';

interface Props extends TextInputProps {
  label: string;
  error?: string;
  hint?: string;
  /** Rendered inside the field, before the input (e.g. a "+374" prefix). */
  prefix?: string;
  /**
   * What this field is called in the diagnostic log.
   *
   * The label was doing this job and is the wrong thing for it twice over: it
   * is translated, so a log from a phone in Armenian cannot be read against a
   * log from one in English, and two fields whose labels happen to be similar
   * are indistinguishable at a glance in a photograph. A short ASCII id
   * (`phone`, `referral`) is stable across languages and short enough to stay
   * on one row.
   *
   * Optional: a screen that has not been given one keeps logging its label,
   * exactly as before.
   */
  traceId?: string;
  /**
   * Adds a show/hide eye inside the field, for a password.
   *
   * Opt-in rather than inferred from `secureTextEntry`: the existing password
   * fields — sign-in, change-password, delete-account — are deliberately left
   * as they are, and a control that appeared on all of them at once would be
   * a redesign smuggled in under a bug fix. The one screen that needs it is
   * the one where a typo is expensive, because the password being typed is
   * being chosen rather than recalled.
   *
   * `label` is what the control is *called*, not what it draws: it names the
   * button for a screen reader, which is what keeps the glyph from being the
   * only way to know what pressing it does.
   *
   * The caller keeps ownership of `secureTextEntry`; this only draws the
   * control and reports the presses.
   */
  revealToggle?: { revealed: boolean; onToggle: () => void; label: string };
}

/**
 * Focus is signalled by the brand blue arriving on the border and a soft
 * glow behind it, rather than by a colour flood — the field stays quiet
 * until the user is actually in it.
 *
 * The resting fill is a 5%-white wash rather than a solid panel. On a dark
 * UI a field filled with a lighter grey reads as *disabled*, because that is
 * what a greyed control looks like everywhere else; a barely-lit well reads
 * as empty and waiting, which is what it is.
 */
export function TextField({
  label,
  error,
  hint,
  prefix,
  revealToggle,
  traceId,
  // Pulled out of the spread only so the diagnostic log can name it, and
  // handed straight back to the input below unchanged.
  keyboardType,
  style,
  onFocus,
  onBlur,
  onPress,
  onPressIn,
  ...rest
}: Props) {
  const { color, space, radius, text, glass, premium } = useTheme();
  const [focused, setFocused] = useState(false);
  /*
   * Whether focus changes re-render this field at all — the second
   * experiment arm, `true` in every build except a diagnostic one where the
   * RR button turns it off.
   *
   * The build-34 log points here rather than at the ScrollView. A tap whose
   * `REQ focus` produced no focus event, because the field already held it,
   * kept its keyboard; every tap that produced a focus event lost the focus
   * 25–33 ms later. The only thing this component does on a focus event is
   * `setFocused`, and its only effect is a re-render.
   */
  const focusRerender = useFocusRerender();
  // What this field is called in the log, and what the mount trace names.
  const traced = traceId ?? label;
  /*
   * Whether this particular input was replaced rather than re-rendered.
   *
   * The registration screen has two fields, and the reported sequence there
   * involves the keyboard changing type — which a *different* input taking
   * focus would produce, and which a re-render of the same input would not.
   * Those two are indistinguishable from focus and blur alone, so each
   * instance says when it arrives and when it goes, with an id that does not
   * repeat within a run.
   */
  useMountTrace(`field:${traced}`);
  const wrapper = useRef<View>(null);
  /*
   * The box that draws the border and the ring, and the node the third
   * experiment arm acts on. It needs a ref of its own for one reason: its
   * native tag is what `logNativeShape` asks about, and where its children
   * are mounted is the thing under test.
   */
  const field = useRef<View>(null);
  const input = useRef<TextInput>(null);

  /*
   * Registers this input so a keyboard event can name what is focused.
   *
   * `isFocused()` is React Native's own answer rather than the `focused`
   * state above, and deliberately so: the state is what draws the ring, and
   * the ring is what must not be used as evidence of focus. See
   * `focusRegistry.ts` for what that answer is and is not worth.
   */
  useEffect(
    () =>
      registerInput({
        traceId: traced,
        keyboardType: keyboardType ?? 'default',
        isFocused: () => input.current?.isFocused() ?? false,
        // Lets a focus *command* be named for this field rather than logged
        // as a pointer — see `focusCommandTrace.ts`.
        node: () => input.current,
      }),
    [traced, keyboardType],
  );
  /*
   * The three tags this field owns, and where the box's children actually
   * live, written once on arrival.
   *
   * `tags` measures what used to be argued about: `#2988` was read off the
   * log and matched against `focus phone t=2988`, but `#2990` and `#2992`
   * were *derived* from Fabric's tag allocation order and never measured.
   *
   * The `shape` line is the one that matters, and it is why this survives the
   * experiment that produced it. `kids=0` on the box means its children are
   * mounted somewhere else — flattened, the state the fault lived in — and
   * `kids=2` means they are inside it. So it reads the fix back off the
   * native tree rather than inferring it from the fault not happening, which
   * is exactly what is needed to confirm the permanent
   * `collapsable={false}` on each handset it has to be checked on.
   *
   * Delayed by a frame's worth of milliseconds because the first commit has
   * to reach the UI thread before there is anything true to read.
   */
  useEffect(() => {
    // Native tags are a native idea. `react-native-web` keeps `findNodeHandle`
    // in its API surface and throws the moment it is called — "findNodeHandle
    // is not supported on web" — which killed the whole render, not just this
    // line, because it happens inside an effect during mount. The browser has
    // no native tree to describe, so there is nothing here worth doing there.
    if (Platform.OS === 'web') return;
    const timer = setTimeout(() => {
      const fieldTag = findNodeHandle(field.current);
      logEvent(
        `tags ${traced} w=${findNodeHandle(wrapper.current) ?? '?'}` +
          ` f=${fieldTag ?? '?'} i=${findNodeHandle(input.current) ?? '?'}`,
      );
      void logNativeShape(traced, fieldTag);
    }, 100);
    return () => clearTimeout(timer);
  }, [traced]);

  // Scrolls this field clear of the keyboard when it is tapped. A no-op on a
  // screen that does not scroll.
  const ensureVisible = useEnsureVisibleOnFocus();

  const borderColor = error ? color.dangerFill : focused ? color.borderFocus : glass.border;

  return (
    <View
      ref={wrapper}
      /*
       * A finger landing on this field, recorded and not otherwise acted on.
       *
       * `onTouchStart` observes; it does not become the responder and does
       * not consume anything, so the field behaves exactly as before. It is
       * here for the one question the focus lines cannot answer on their own:
       * whether a person touched the field that took focus. A `focus
       * password` with no `touch password` before it was not a tap.
       */
      onTouchStart={() => logEvent(`touch ${traced}`)}
      /*
       * Every layout of this field, recorded.
       *
       * A view that is detached and re-attached keeps its native tag, so
       * stable tags in the log never excluded that — the objection is fair
       * and this is the nearest signal available from JavaScript. A `layout`
       * line landing between `focus` and `blur` says the field was laid out
       * again in that window, which a detach and re-attach would produce.
       *
       * It is not proof of one: an ordinary re-layout produces it too. It is
       * a signal to correlate, and it is labelled that way rather than
       * treated as a verdict.
       */
      onLayout={(event) =>
        logEvent(`layout ${traced} h=${Math.round(event.nativeEvent.layout.height)}`)
      }
      style={{ marginBottom: space[4] }}
    >
      <Text style={[text.label, { color: color.textSecondary, marginBottom: space[2] }]}>
        {label}
      </Text>

      <View
        ref={field}
        /*
         * The fix, and it is not conditional on anything.
         *
         * Without it this box is a Fabric "layout only" node while at rest:
         * it has a background and a border so it gets a native view, but no
         * `shadowColor` and no `elevation`, so it is not a stacking context
         * and its children are mounted into the wrapper above instead of into
         * it. Taking focus adds the ring's `shadowColor`, the node becomes a
         * stacking context, and the differ reparents its children — removing
         * the focused `ReactEditText` from one parent and inserting it into
         * another. Android then drops the focus off a view it no longer owns,
         * and the keyboard goes with it.
         *
         * `collapsable={false}` is the first term of that same predicate, so
         * the box is a stacking context in both states and there is nothing
         * left to flip. Confirmed on a handset across CF=off → on → off in
         * build 41 (runs SS06VF and 0HX8CM): the focus-time detaches vanish
         * with it on and come back with it off, and the `shape` lines show
         * the children moving between the two parents exactly as predicted.
         *
         * What that does **not** establish is that `shadowColor` is the
         * culprit. This prop pins the whole `FormsStackingContext` trait, and
         * `elevation`, `opacity`, `transform`, `zIndex` and the event flags
         * are all in the same predicate. The mechanism is proven; which
         * property was tripping it is not, and separating them would take one
         * more experiment that nothing currently depends on.
         *
         * Android-only in effect; inert on iOS and web.
         */
        collapsable={false}
        style={[
          styles.field,
          {
            backgroundColor: focused ? glass.light : glass.background,
            borderColor,
            borderRadius: radius.md,
            paddingHorizontal: space[4],
            gap: space[1],
          },
          focused && !error
            ? { shadowColor: premium.brand.primary, ...styles.ring }
            : null,
          error ? { shadowColor: color.dangerFill, ...styles.ring } : null,
        ]}
      >
        {prefix ? (
          <Text style={[text.body, { color: color.textSecondary }]}>{prefix}</Text>
        ) : null}
        <TextInput
          /*
           * Android's autofill service is told to leave these alone.
           *
           * On the phone this was reported from, touching any field made all
           * three light up at once and blink, and typing became impossible.
           * The app cannot produce that: each field owns its own focus state
           * and only the focused one draws a ring. What draws on all of them
           * at once is the autofill service — it activates on touch,
           * highlights every field it believes it can fill, and can hold the
           * focus while it decides which. Reported on a Xiaomi handset; the
           * service is part of Android rather than any vendor's shell, so the
           * behaviour is not specific to one make.
           *
           * `autoComplete` stays: it is also what selects the right keyboard
           * and drives the iOS suggestion bar. This switches off only the
           * Android overlay that was competing for the focus.
           *
           * If a password manager turns out to matter more than this, change
           * it here, per field, rather than by removing the hints.
           */
          importantForAutofill="no"
          placeholderTextColor={color.textTertiary}
          // Without this the OS paints a black caret on a black field, and
          // the user cannot see where they are typing.
          selectionColor={premium.brand.light}
          ref={input}
          keyboardType={keyboardType}
          /*
           * The press that React Native turns into a focus call.
           *
           * `TextInput` builds an unconditional `usePressability` config whose
           * `onPress` runs `onPress?.(event)` and then `inputRef.current
           * .focus()` — so a tap on a field does go through JavaScript, and
           * the `REQ focus …` line it produces is React Native behaving
           * normally rather than something to chase.
           *
           * Passing these two changes nothing: the config forwards them and
           * focuses either way. What they buy is the ability to tell those
           * two cases apart in the log — a `REQ focus password` preceded by
           * `press password` came through this path, and one that is not
           * preceded by it came from somewhere else entirely.
           */
          onPressIn={(event) => {
            logEvent(`pressIn ${traced}`);
            onPressIn?.(event);
          }}
          onPress={(event) => {
            logEvent(`press ${traced}`);
            onPress?.(event);
          }}
          onFocus={(event) => {
            // The label, the keyboard it asks for and the native view tag —
            // never the value. A password in a screenshot would be a far
            // worse bug than the one being chased.
            //
            // The keyboard type is here because the reported fault is a
            // keyboard changing type. The tag is here because a native view
            // can be replaced without React remounting anything: if the same
            // field reports two different tags across one interaction, the
            // view underneath it was rebuilt, and no mount counter would ever
            // have shown that.
            logEvent(
              // Optional access on purpose: a throw inside `onFocus` would take
              // down the very interaction being recorded, and a caller that
              // passes no event (a test, a future React Native) must not be
              // able to cause that.
              `focus ${traced} kbd=${keyboardType ?? 'default'} t=${event?.nativeEvent?.target ?? '?'}`,
            );
            if (focusRerender) setFocused(true);
            ensureVisible(wrapper.current);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            logEvent(`blur  ${traced} t=${event?.nativeEvent?.target ?? '?'}`);
            if (focusRerender) setFocused(false);
            onBlur?.(event);
          }}
          style={[styles.input, text.body, { color: color.textPrimary }, style]}
          {...rest}
          /*
           * After the spread on purpose: this wins over anything a screen
           * passes, so no field anywhere can opt back in.
           *
           * `importantForAutofill="no"` above was expected to be enough and
           * was not. Android's autofill service still recognises a field it
           * has an `autofillHints` value for — which is what `autoComplete`
           * compiles to — and highlights every field it believes it can fill.
           * That is what puts a wash of colour across several fields at once
           * while React's own `focused` state names exactly one, and it is why
           * a photograph of the fault looked like the app lighting two fields
           * that the app cannot light.
           *
           * The cost is real and is accepted deliberately: password managers
           * can no longer fill these fields, the iOS suggestion bar is quiet,
           * and an SMS code has to be typed rather than offered. A form that
           * can be filled in slowly beats one that cannot be filled in at all.
           * If a device is ever confirmed clean, this is the first thing to
           * put back — per field, not by deleting the line.
           */
          autoComplete="off"
        />
        {revealToggle ? (
          <Pressable
            onPress={revealToggle.onToggle}
            accessibilityRole="button"
            accessibilityLabel={revealToggle.label}
            // Bigger than the glyph: the control sits at the edge of a field
            // the thumb is already near, and a 14pt target there is a
            // mis-tap that clears nothing but wastes the attempt.
            hitSlop={12}
          >
            <EyeIcon
              size={20}
              // Secondary, not brand: the eye sits inside a field the customer
              // is typing in, and a coloured control there competes with the
              // focus ring for the same glance.
              color={color.textSecondary}
              crossed={revealToggle.revealed}
            />
          </Pressable>
        ) : null}
      </View>

      {error ? (
        <Text style={[text.caption, { color: color.dangerText, marginTop: space[2] }]}>
          {error}
        </Text>
      ) : hint ? (
        <Text style={[text.caption, { color: color.textTertiary, marginTop: space[2] }]}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // `minHeight`, not `height`. A fixed 54 clipped the text on a phone with
  // the system font scale turned up — the control kept its size and the
  // characters lost theirs. The field grows instead; nothing else about it
  // changes at the default scale.
  field: { flexDirection: 'row', alignItems: 'center', minHeight: 54, borderWidth: 1 },
  input: { flex: 1, paddingVertical: 14 },
  /*
   * The focus glow.
   *
   * `elevation` was removed from here on 2026-09-08 as a candidate fix — it
   * was the only thing this component changed on focus that is not paint, and
   * on Android it is the view's Z, which makes the parent rebuild its ordered
   * child list. The device log from that build (`run OZPR8P`, commit
   * `1c9c823`) shows the focus churn completely unchanged, so it is put back:
   * a visual regression that fixes nothing is worse than the shadow.
   *
   * Recorded rather than quietly reverted, because "elevation is excluded" is
   * itself a finding, and the next person to notice this line should not have
   * to spend a build discovering it again.
   */
  ring: {
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },
});

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../app/theme/ThemeProvider';

interface Props {
  checked: boolean;
  onToggle: (next: boolean) => void;
  label: string;
  /** The documents this choice is about, each opening the full text. */
  links?: Array<{ label: string; onPress: () => void }>;
  testID?: string;
}

/**
 * One consent, unticked until someone ticks it.
 *
 * There is no "agree to everything" here and there is not meant to be: each
 * of the two mandatory choices is its own control with its own label, because
 * bundling them is precisely what makes a consent unfree. The box starts
 * empty — a pre-ticked box is not a choice — and the whole row is the hit
 * target, with the document links as separate presses underneath so that
 * reading the text and agreeing to it are never the same tap.
 */
export function ConsentCheckbox({ checked, onToggle, label, links = [], testID }: Props) {
  const { color, space, text } = useTheme();
  return (
    <View style={{ marginTop: space[3] }}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked }}
        accessibilityLabel={label}
        testID={testID}
        onPress={() => onToggle(!checked)}
        hitSlop={6}
        style={[styles.row, { gap: space[2] }]}
      >
        <View
          style={[
            styles.box,
            {
              borderColor: checked ? color.primary : color.borderStrong,
              backgroundColor: checked ? color.primary : 'transparent',
            },
          ]}
        >
          {checked ? <Ionicons name="checkmark" size={14} color={color.textInverse} /> : null}
        </View>
        <Text style={[text.bodySm, styles.flex, { color: color.textPrimary }]}>{label}</Text>
      </Pressable>
      {links.length > 0 ? (
        <View style={[styles.links, { marginLeft: 20 + space[2], gap: space[3] }]}>
          {links.map((link) => (
            <Pressable key={link.label} onPress={link.onPress} hitSlop={6}>
              <Text style={[text.caption, { color: color.primary, textDecorationLine: 'underline' }]}>
                {link.label}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  flex: { flex: 1 },
  links: { flexDirection: 'row', flexWrap: 'wrap' },
  box: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
});

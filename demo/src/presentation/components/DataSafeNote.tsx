import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../app/theme/ThemeProvider';

/**
 * "Your data is safe", with a small padlock, under the one button on a form
 * that sends something personal — a phone number, a password, a business's
 * legal name. The same line under every such button, so it reads as a
 * property of the product rather than a promise on one screen.
 */
export function DataSafeNote() {
  const { t } = useTranslation();
  const { color, space, text } = useTheme();
  return (
    <View style={[styles.row, { marginTop: space[3], gap: space[1] }]} accessibilityRole="text">
      <Ionicons name="lock-closed" size={13} color={color.textTertiary} />
      <Text style={[text.caption, { color: color.textTertiary }]}>{t('scene.dataSafe')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
});

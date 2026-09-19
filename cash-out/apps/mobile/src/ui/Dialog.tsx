import React from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import { useTheme } from '../theme/theme';
import { Button } from './Button';
import { Text } from './Text';

/**
 * A blocking confirmation. Used for destructive or irreversible choices only —
 * signing out, removing a card — never for information a toast could carry.
 */
export function Dialog({
  visible,
  title,
  body,
  confirmLabel,
  cancelLabel,
  destructive = false,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  title: string;
  body?: string;
  confirmLabel: string;
  cancelLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const theme = useTheme();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={[styles.backdrop, { backgroundColor: theme.colors.overlay }]}>
        <View
          style={[
            styles.dialog,
            theme.elevation.sheet,
            {
              backgroundColor: theme.colors.surface,
              borderRadius: theme.radius.xl,
              padding: theme.spacing.xl,
            },
          ]}
        >
          <Text variant="title" align="center">
            {title}
          </Text>
          {body ? (
            <Text
              variant="body"
              tone="secondary"
              align="center"
              style={{ marginTop: theme.spacing.sm }}
            >
              {body}
            </Text>
          ) : null}

          <View style={{ gap: theme.spacing.sm, marginTop: theme.spacing.xl }}>
            <Button
              label={confirmLabel}
              variant={destructive ? 'danger' : 'primary'}
              onPress={onConfirm}
            />
            <Button label={cancelLabel} variant="ghost" onPress={onCancel} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  dialog: { width: '100%', maxWidth: 400 },
});

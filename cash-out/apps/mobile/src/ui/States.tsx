import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTheme } from '../theme/theme';
import { Button } from './Button';
import { Text } from './Text';

/**
 * Empty and error states.
 *
 * Both always offer a way forward. An error screen that only says what went
 * wrong leaves a driver holding a phone with their wages on the other side of
 * it; the retry button is not decoration.
 */
export function EmptyState({
  title,
  body,
  actionLabel,
  onAction,
  glyph = '🗒',
}: {
  title: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
  glyph?: string;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.root, { paddingVertical: theme.spacing.xxxl }]}>
      <Text variant="titleLarge" align="center" style={{ fontSize: 40 }}>
        {glyph}
      </Text>
      <Text variant="title" align="center" style={{ marginTop: theme.spacing.base }}>
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
      {actionLabel && onAction ? (
        <Button
          label={actionLabel}
          variant="secondary"
          fullWidth={false}
          onPress={onAction}
          style={{ marginTop: theme.spacing.xl }}
        />
      ) : null}
    </View>
  );
}

export function ErrorState({
  title,
  body,
  retryLabel,
  onRetry,
}: {
  title: string;
  body?: string;
  retryLabel: string;
  onRetry: () => void;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.root, { paddingVertical: theme.spacing.xxxl }]}>
      <View
        style={[
          styles.badge,
          { backgroundColor: theme.colors.dangerSoft, borderRadius: theme.radius.pill },
        ]}
      >
        <Text variant="title" tone="danger">
          !
        </Text>
      </View>
      <Text variant="title" align="center" style={{ marginTop: theme.spacing.base }}>
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
      <Button
        label={retryLabel}
        variant="secondary"
        fullWidth={false}
        onPress={onRetry}
        style={{ marginTop: theme.spacing.xl }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: 'center', justifyContent: 'center', flexGrow: 1 },
  badge: { width: 56, height: 56, alignItems: 'center', justifyContent: 'center' },
});

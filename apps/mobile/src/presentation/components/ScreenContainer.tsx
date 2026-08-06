import React from 'react';
import { ScrollView, StyleSheet, View, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppTheme } from '../../app/theme/ThemeProvider';

interface Props {
  children: React.ReactNode;
  scroll?: boolean;
  style?: ViewStyle;
}

export function ScreenContainer({ children, scroll = true, style }: Props) {
  const { theme, spacing } = useAppTheme();
  const Container = scroll ? ScrollView : View;

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: theme.background }]} edges={['top']}>
      <Container
        style={styles.flex}
        contentContainerStyle={
          scroll ? { padding: spacing.lg, paddingBottom: spacing.xxl } : undefined
        }
      >
        <View style={[!scroll && { flex: 1, padding: spacing.lg }, style]}>{children}</View>
      </Container>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
});

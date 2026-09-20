import React from 'react';
import { Tabs } from 'expo-router';
import type { ColorValue } from 'react-native';
import { useI18n } from '../../src/i18n/i18n';
import { useTheme } from '../../src/theme/theme';
import { Text } from '../../src/ui';

/**
 * Five tabs, the ones the specification names: Home, Balance, Withdraw,
 * History, Settings. Profile, the taxi park and security are reached from
 * Settings. Labels are never truncated — Armenian labels are long, and the bar
 * grows a line rather than showing "Կարգավոր…".
 */
export default function TabsLayout() {
  const theme = useTheme();
  const { t } = useI18n();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.textTertiary,
        tabBarStyle: {
          backgroundColor: theme.colors.surface,
          borderTopColor: theme.colors.border,
          height: 72,
          paddingTop: 8,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        tabBarAllowFontScaling: false,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('tabs.home'),
          tabBarIcon: ({ color }) => <Glyph glyph="⌂" color={color} />,
        }}
      />
      <Tabs.Screen
        name="balance"
        options={{
          title: t('tabs.balance'),
          tabBarIcon: ({ color }) => <Glyph glyph="֏" color={color} />,
        }}
      />
      <Tabs.Screen
        name="withdraw"
        options={{
          title: t('tabs.withdraw'),
          tabBarIcon: ({ color }) => <Glyph glyph="↗" color={color} />,
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: t('tabs.history'),
          tabBarIcon: ({ color }) => <Glyph glyph="≡" color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: t('tabs.settings'),
          tabBarIcon: ({ color }) => <Glyph glyph="⚙" color={color} />,
        }}
      />
    </Tabs>
  );
}

function Glyph({ glyph, color }: { glyph: string; color: ColorValue }) {
  return (
    <Text variant="title" style={{ color, lineHeight: 24 }}>
      {glyph}
    </Text>
  );
}

import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../theme/ThemeProvider';
import { HomeScreen } from '../../presentation/screens/home/HomeScreen';
import { WalletScreen } from '../../presentation/screens/wallet/WalletScreen';
import { MyQrScreen } from '../../presentation/screens/qr/MyQrScreen';
import { EvStationsScreen } from '../../presentation/screens/ev/EvStationsScreen';
import { SettingsScreen } from '../../presentation/screens/settings/SettingsScreen';
import type { MainTabParamList } from './types';

const Tab = createBottomTabNavigator<MainTabParamList>();

/** Filled when active, outline when not — the standard iOS idiom. */
const ICONS: Record<keyof MainTabParamList, [keyof typeof Ionicons.glyphMap, keyof typeof Ionicons.glyphMap]> = {
  Home: ['home-outline', 'home'],
  Wallet: ['wallet-outline', 'wallet'],
  Pay: ['qr-code-outline', 'qr-code'],
  EvCharging: ['flash-outline', 'flash'],
  Settings: ['person-outline', 'person'],
};

export function MainTabNavigator() {
  const { t } = useTranslation();
  const { color, text, layout, glass } = useTheme();

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: color.primary,
        tabBarInactiveTintColor: color.textTertiary,
        tabBarStyle: {
          // Slightly lifted off the ground rather than the same black, so
          // the bar reads as a surface the content scrolls beneath instead
          // of as the end of the screen.
          backgroundColor: color.backgroundSubtle,
          borderTopColor: glass.border,
          borderTopWidth: StyleSheet.hairlineWidth,
          height: layout.tabBarHeight,
          paddingTop: 8,
          paddingBottom: Platform.OS === 'ios' ? 28 : 12,
        },
        tabBarLabelStyle: {
          fontSize: text.overline.fontSize,
          fontWeight: text.label.fontWeight,
          letterSpacing: 0,
        },
        tabBarIcon: ({ color: c, size, focused }) => {
          const [outline, filled] = ICONS[route.name as keyof MainTabParamList];
          return <Ionicons name={focused ? filled : outline} size={size - 2} color={c} />;
        },
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} options={{ title: t('nav.home') }} />
      <Tab.Screen name="Wallet" component={WalletScreen} options={{ title: t('wallet.title') }} />
      <Tab.Screen
        name="Pay"
        component={MyQrScreen}
        options={{
          title: t('nav.pay'),
          // The pay tab is the app's primary verb, so its icon is given a
          // filled brand chip to stand slightly proud of its neighbours.
          tabBarIcon: ({ focused }) => <PayTabIcon focused={focused} />,
        }}
      />
      <Tab.Screen name="EvCharging" component={EvStationsScreen} options={{ title: t('nav.charge') }} />
      <Tab.Screen name="Settings" component={SettingsScreen} options={{ title: t('nav.profile') }} />
    </Tab.Navigator>
  );
}

function PayTabIcon({ focused }: { focused: boolean }) {
  const { color, radius, gradients, glow } = useTheme();

  // Focused, it wears the identity gradient and its glow — the only place in
  // the tab bar that does, which is how the app's primary verb stays
  // findable without making the icon bigger than its neighbours.
  if (focused) {
    return (
      <LinearGradient
        colors={[...gradients.primary]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.payChip, glow.sm.native, { borderRadius: radius.md }]}
      >
        <Ionicons name="qr-code" size={18} color={color.textInverse} />
      </LinearGradient>
    );
  }

  return (
    <View
      style={[styles.payChip, { backgroundColor: color.primarySurface, borderRadius: radius.md }]}
    >
      <Ionicons name="qr-code" size={18} color={color.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  payChip: { width: 40, height: 30, alignItems: 'center', justifyContent: 'center' },
});

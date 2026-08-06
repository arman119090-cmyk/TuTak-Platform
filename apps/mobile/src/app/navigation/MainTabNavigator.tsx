import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../theme/ThemeProvider';
import { HomeScreen } from '../../presentation/screens/home/HomeScreen';
import { WalletScreen } from '../../presentation/screens/wallet/WalletScreen';
import { MyQrScreen } from '../../presentation/screens/qr/MyQrScreen';
import { EvStationsScreen } from '../../presentation/screens/ev/EvStationsScreen';
import { SettingsScreen } from '../../presentation/screens/settings/SettingsScreen';
import type { MainTabParamList } from './types';

const Tab = createBottomTabNavigator<MainTabParamList>();

const ICONS: Record<keyof MainTabParamList, keyof typeof Ionicons.glyphMap> = {
  Home: 'home-outline',
  Wallet: 'wallet-outline',
  Pay: 'qr-code-outline',
  EvCharging: 'flash-outline',
  Settings: 'settings-outline',
};

export function MainTabNavigator() {
  const { t } = useTranslation();
  const { theme } = useAppTheme();

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: theme.primary,
        tabBarInactiveTintColor: theme.textSecondary,
        tabBarStyle: { backgroundColor: theme.surfaceAlt, borderTopColor: theme.border },
        tabBarIcon: ({ color, size }) => (
          <Ionicons name={ICONS[route.name as keyof MainTabParamList]} size={size} color={color} />
        ),
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} options={{ title: t('common.appName') }} />
      <Tab.Screen name="Wallet" component={WalletScreen} options={{ title: t('wallet.title') }} />
      <Tab.Screen name="Pay" component={MyQrScreen} options={{ title: t('qr.myQr') }} />
      <Tab.Screen name="EvCharging" component={EvStationsScreen} options={{ title: t('ev.stations') }} />
      <Tab.Screen name="Settings" component={SettingsScreen} options={{ title: t('settings.title') }} />
    </Tab.Navigator>
  );
}

import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../theme/ThemeProvider';
import { MainTabNavigator } from './MainTabNavigator';
import { ScanQrScreen } from '../../presentation/screens/qr/ScanQrScreen';
import { NotificationsScreen } from '../../presentation/screens/notifications/NotificationsScreen';
import { TransactionHistoryScreen } from '../../presentation/screens/transactions/TransactionHistoryScreen';
import { ReferralScreen } from '../../presentation/screens/referral/ReferralScreen';
import { EvHistoryScreen } from '../../presentation/screens/ev/EvHistoryScreen';
import { ChangePasswordScreen } from '../../presentation/screens/settings/ChangePasswordScreen';
import { VerifyPhoneScreen } from '../../presentation/screens/settings/VerifyPhoneScreen';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  const { t } = useTranslation();
  const { color, text } = useTheme();

  return (
    <Stack.Navigator
      screenOptions={{
        headerShadowVisible: false,
        headerStyle: { backgroundColor: color.background },
        headerTitleStyle: {
          color: color.textPrimary,
          fontSize: text.headline.fontSize,
          fontWeight: text.headline.fontWeight,
        },
        headerTintColor: color.primary,
        headerBackTitle: '',
        contentStyle: { backgroundColor: color.background },
      }}
    >
      <Stack.Screen name="Main" component={MainTabNavigator} options={{ headerShown: false }} />

      {/* Scanning is full-bleed camera, so it presents modally with no header. */}
      <Stack.Screen
        name="ScanQr"
        component={ScanQrScreen}
        options={{ presentation: 'fullScreenModal', headerShown: false }}
      />

      {/* These screens draw their own titles via <Screen>, so the native
          header only supplies the back affordance. */}
      <Stack.Screen
        name="Notifications"
        component={NotificationsScreen}
        options={{ title: t('notifications.title'), headerShown: false }}
      />
      <Stack.Screen
        name="TransactionHistory"
        component={TransactionHistoryScreen}
        options={{ title: t('wallet.history'), headerShown: false }}
      />
      <Stack.Screen
        name="Referral"
        component={ReferralScreen}
        options={{ title: t('referral.inviteFriends'), headerShown: false }}
      />
      <Stack.Screen
        name="EvHistory"
        component={EvHistoryScreen}
        options={{ title: t('ev.history'), headerShown: false }}
      />
      <Stack.Screen
        name="ChangePassword"
        component={ChangePasswordScreen}
        options={{ title: t('settings.changePassword'), headerShown: false }}
      />
      <Stack.Screen
        name="VerifyPhone"
        component={VerifyPhoneScreen}
        options={{ title: t('auth.otpTitle'), headerShown: false }}
      />
    </Stack.Navigator>
  );
}

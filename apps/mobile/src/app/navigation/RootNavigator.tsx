import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { MainTabNavigator } from './MainTabNavigator';
import { ScanQrScreen } from '../../presentation/screens/qr/ScanQrScreen';
import { NotificationsScreen } from '../../presentation/screens/notifications/NotificationsScreen';
import { TransactionHistoryScreen } from '../../presentation/screens/transactions/TransactionHistoryScreen';
import { ReferralScreen } from '../../presentation/screens/referral/ReferralScreen';
import { EvHistoryScreen } from '../../presentation/screens/ev/EvHistoryScreen';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  const { t } = useTranslation();

  return (
    <Stack.Navigator>
      <Stack.Screen name="Main" component={MainTabNavigator} options={{ headerShown: false }} />
      <Stack.Screen name="ScanQr" component={ScanQrScreen} options={{ title: t('qr.scanQr') }} />
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
    </Stack.Navigator>
  );
}

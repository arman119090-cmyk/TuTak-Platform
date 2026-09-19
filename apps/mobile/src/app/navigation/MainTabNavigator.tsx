import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../theme/ThemeProvider';
import { V2NavIcon } from '../../presentation/components/V2NavIcon';
import { HomeScreen } from '../../presentation/screens/home/HomeScreen';
import { WalletScreen } from '../../presentation/screens/wallet/WalletScreen';
import { MyQrScreen } from '../../presentation/screens/qr/MyQrScreen';
import { PartnersScreen } from '../../presentation/screens/partners/PartnersScreen';
import { SettingsScreen } from '../../presentation/screens/settings/SettingsScreen';
import type { MainTabParamList } from './types';
import type { V2NavIconName } from '@tutak/design';

const Tab = createBottomTabNavigator<MainTabParamList>();

/**
 * Bottom-nav icon family — `TUTAK_V2_COMPONENT_INVENTORY.md`: "use the
 * Jako-derived SVG family: open nest, flight pin, QR eye, folded wing,
 * profile head; QR is central/larger; referral is accessed from Home and
 * Profile, not a sixth tab." `Partners` carries the Map tab.
 *
 * Pilot rule: the central QR action is the customer's primary purchase
 * action, so tapping it opens the root `ScanQr` screen. `MyQrScreen` remains
 * mounted as the tab component for backward compatibility/deep navigation,
 * but ordinary tab presses are intercepted before it renders. This avoids
 * presenting the old customer-presented QR surface as the main pilot flow.
 */
const ICONS: Record<keyof MainTabParamList, V2NavIconName> = {
  Home: 'home',
  Wallet: 'wallet',
  Pay: 'qr',
  Partners: 'map',
  Settings: 'profile',
};

export function MainTabNavigator() {
  const { t } = useTranslation();
  const { color, text, layout, palette } = useTheme();
  const insets = useSafeAreaInsets();
  const androidBottomPadding = Math.max(20, insets.bottom);

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: color.primary,
        tabBarInactiveTintColor: palette.neutral[400],
        // White, edgeless. The hairline that used to run across the top of
        // the bar was one more line under a screen already full of them;
        // the bar is separated from content by tone alone (content scrolls
        // under white) plus a whisper of shadow upward.
        tabBarStyle: {
          backgroundColor: color.surface,
          borderTopWidth: 0,
          elevation: 0,
          shadowColor: '#101828',
          shadowOpacity: 0.06,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: -2 },
          height:
            Platform.OS === 'android'
              ? layout.tabBarHeight + insets.bottom
              : layout.tabBarHeight,
          paddingTop: 10,
          paddingBottom: Platform.OS === 'ios' ? 28 : androidBottomPadding,
        },
        tabBarItemStyle: { gap: 2 },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: text.label.fontWeight,
          letterSpacing: 0,
        },
        tabBarIcon: ({ color: c, size }) => {
          const name = ICONS[route.name as keyof MainTabParamList];
          if (name === 'qr') return null;
          return (
            <V2NavIcon
              name={name}
              size={size}
              color={c}
              // One stroke for the family, focused or not: colour carries the
              // state. A stroke that thickens on focus made the active icon
              // look like a different, heavier icon.
              strokeWidth={2.6}
            />
          );
        },
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} options={{ title: t('nav.home') }} />
      <Tab.Screen name="Wallet" component={WalletScreen} options={{ title: t('wallet.title') }} />
      <Tab.Screen
        name="Pay"
        component={MyQrScreen}
        listeners={({ navigation }) => ({
          tabPress: (event) => {
            event.preventDefault();
            const parent = navigation.getParent();
            if (parent) parent.navigate('ScanQr' as never);
          },
        })}
        options={{
          title: t('nav.pay'),
          tabBarIcon: ({ focused }) => <PayTabIcon focused={focused} />,
        }}
      />
      <Tab.Screen name="Partners" component={PartnersScreen} options={{ title: t('nav.partners') }} />
      <Tab.Screen name="Settings" component={SettingsScreen} options={{ title: t('nav.profile') }} />
    </Tab.Navigator>
  );
}

/**
 * The central action. A solid brand disc, always — it is the customer's
 * primary purchase action and should look like the one button that is
 * always ready, not a chip that lights up when the tab happens to be the
 * current one. Focus deepens the green by one step; nothing glows.
 */
function PayTabIcon({ focused }: { focused: boolean }) {
  const { color, radius } = useTheme();
  return (
    <View
      style={[
        styles.payDisc,
        { backgroundColor: focused ? color.primaryPressed : color.primary, borderRadius: radius.full },
      ]}
    >
      <V2NavIcon name="qr" size={24} color={color.textInverse} strokeWidth={2.8} />
    </View>
  );
}

const styles = StyleSheet.create({
  payDisc: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center', marginTop: -6 },
});

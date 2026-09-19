import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
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
  const { color, text, layout, glass } = useTheme();
  const insets = useSafeAreaInsets();
  // One rule for both platforms. The bar grows by the live bottom inset —
  // a gesture pill, a Samsung navigation row, an iPhone home indicator —
  // and pads by at least 20 pt so a device reporting no inset (an iPhone
  // with a home button, an emulator) still keeps its labels off the edge.
  // iOS used to hard-code 28 pt with no growth: on an iPhone with a 34 pt
  // indicator the labels sat 6 pt inside it, and on an iPhone SE the 28 pt
  // were wasted.
  const bottomPadding = Math.max(20, insets.bottom);

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: color.primary,
        tabBarInactiveTintColor: color.textTertiary,
        tabBarStyle: {
          backgroundColor: color.backgroundSubtle,
          borderTopColor: glass.border,
          borderTopWidth: StyleSheet.hairlineWidth,
          height: layout.tabBarHeight + insets.bottom,
          paddingTop: 8,
          paddingBottom: bottomPadding,
        },
        tabBarLabelStyle: {
          fontSize: text.overline.fontSize,
          fontWeight: text.label.fontWeight,
          letterSpacing: 0,
        },
        tabBarIcon: ({ color: c, size, focused }) => {
          const name = ICONS[route.name as keyof MainTabParamList];
          if (name === 'qr') return null;
          return (
            <V2NavIcon
              name={name}
              size={size - 2}
              color={c}
              strokeWidth={focused ? 3 : 2.4}
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

function PayTabIcon({ focused }: { focused: boolean }) {
  const { color, radius, gradients, glow } = useTheme();

  if (focused) {
    return (
      <LinearGradient
        colors={[...gradients.primary]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.payChip, glow.sm.native, { borderRadius: radius.full }]}
      >
        <V2NavIcon name="qr" size={22} color={color.textInverse} strokeWidth={3} />
      </LinearGradient>
    );
  }

  return (
    <View
      style={[
        styles.payChip,
        { backgroundColor: color.primarySurface, borderRadius: radius.full },
      ]}
    >
      <V2NavIcon name="qr" size={22} color={color.primary} strokeWidth={2.7} />
    </View>
  );
}

const styles = StyleSheet.create({
  payChip: { width: 48, height: 40, alignItems: 'center', justifyContent: 'center' },
});

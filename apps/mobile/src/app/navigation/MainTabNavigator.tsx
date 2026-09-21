import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
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
  const { color, text, layout } = useTheme();
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
        // 500, not 400: an inactive tab is a place the customer can go, not
        // a disabled one, and 400 on white read as the latter.
        tabBarInactiveTintColor: color.textSecondary,
        // White, edgeless. The hairline that used to run across the top of
        // the bar was one more line under a screen already full of them;
        // the bar is separated from content by tone alone (content scrolls
        // under white) plus a whisper of shadow upward.
        tabBarStyle: {
          // Premium pass 2: white, edgeless, a whisper of shadow upward.
          backgroundColor: color.surface,
          borderTopWidth: 0,
          elevation: 0,
          shadowColor: '#101828',
          shadowOpacity: 0.06,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: -2 },
          // iOS bootstrap: one geometry rule for both platforms — the bar
          // grows by the live bottom inset and pads by at least 20 pt.
          height: layout.tabBarHeight + insets.bottom,
          paddingTop: 6,
          paddingBottom: bottomPadding,
        },
        // Every tab's icon sits in the same 36 pt box — the Pay disc fills
        // it, the outline icons centre in it — so all five labels share one
        // baseline. No horizontal padding on the item: the Armenian labels
        // need every point of the 72–78 pt a fifth of a phone gives them.
        tabBarItemStyle: { gap: 2, paddingHorizontal: 0, overflow: 'visible' },
        tabBarIconStyle: { width: 36, height: 36 },
        tabBarLabel: ({ color: c, children }) => (
          <Text
            style={[styles.label, { color: c, fontWeight: text.label.fontWeight }]}
            numberOfLines={1}
            // "Դրամապանակ" needs ~90 pt at 11 pt and a fifth of a 390 pt
            // phone is 78: the word is measured, not guessed. So the label
            // may overhang its tab by a few points on each side (`overflow:
            // visible` on the item; the neighbours are short words) and, on
            // native, shrinks by at most 10 % before that. Same size for all
            // five — one tab a different size is worse than a tight fit.
            // Below 360 pt the word still cannot fit without a translation
            // decision, which is the owner's, not this file's.
            adjustsFontSizeToFit
            minimumFontScale={0.9}
            maxFontSizeMultiplier={1.2}
          >
            {children}
          </Text>
        ),
        tabBarIcon: ({ color: c }) => {
          const name = ICONS[route.name as keyof MainTabParamList];
          if (name === 'qr') return null;
          return (
            <V2NavIcon
              name={name}
              size={24}
              color={c}
              // One stroke for the family, focused or not: colour carries the
              // state. 2.2 on the 48 pt source canvas lands at the same
              // apparent weight as the 22 pt Ionicons outlines used on every
              // other screen, so the bar and the screens read as one set.
              strokeWidth={2.2}
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
 *
 * The disc is the same 36 pt box every other icon sits in, not a larger one
 * hoisted above the bar: raised, it read as a floating button somebody had
 * placed on top of the navigation rather than the fifth item of it.
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
      <V2NavIcon name="qr" size={22} color={color.textInverse} strokeWidth={2.4} />
    </View>
  );
}

const styles = StyleSheet.create({
  payDisc: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 11, lineHeight: 14, letterSpacing: -0.2, textAlign: 'center', minWidth: 88 },
});

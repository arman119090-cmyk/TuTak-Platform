import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';
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
 * Profile, not a sixth tab." `Partners` carries the Map tab (see
 * `MainTabParamList`'s own note on why Map and the station filter share one
 * route), so it renders the `map` icon.
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
  // Android's system nav bar (gesture pill or 3-button bar) sits in this
  // inset, and its height varies by device — a fixed padding either wastes
  // space or, worse, leaves the tab bar's own buttons underneath it, exactly
  // where the system's own buttons are hardest to avoid mis-tapping. See
  // `TUTAK_V2_ANDROID_SYSTEM_UI_QA.md` rule 4: this height still has to be
  // the *actual* rendered bar height plus the live inset, never a
  // guessed/fixed device constant — `layout.tabBarHeight` is the bar's own
  // fixed content height, and `insets.bottom` (read live, every render) is
  // what is added on top of it for Android, exactly as before.
  const insets = useSafeAreaInsets();
  const androidBottomPadding = Math.max(12, insets.bottom);

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: color.primary,
        tabBarInactiveTintColor: color.textTertiary,
        tabBarStyle: {
          // Slightly lifted off the ground rather than the same white, so
          // the bar reads as a surface the content scrolls beneath instead
          // of as the end of the screen.
          backgroundColor: color.backgroundSubtle,
          borderTopColor: glass.border,
          borderTopWidth: StyleSheet.hairlineWidth,
          height: Platform.OS === 'android' ? layout.tabBarHeight + insets.bottom : layout.tabBarHeight,
          paddingTop: 8,
          paddingBottom: Platform.OS === 'ios' ? 28 : androidBottomPadding,
        },
        tabBarLabelStyle: {
          fontSize: text.overline.fontSize,
          fontWeight: text.label.fontWeight,
          letterSpacing: 0,
        },
        tabBarIcon: ({ color: c, size, focused }) => {
          const name = ICONS[route.name as keyof MainTabParamList];
          // QR gets its own larger chip treatment below; every other tab is
          // a plain outline icon at the standard nav size.
          if (name === 'qr') return null;
          return <V2NavIcon name={name} size={size - 2} color={c} strokeWidth={focused ? 3 : 2.4} />;
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
          // "Central QR" — master spec: "one fixed bottom navigation with a
          // visually larger central QR action". Focused, it wears the
          // identity gradient and its glow, the only place in the tab bar
          // that does, which is how the app's primary verb stays findable
          // without the label alone carrying it.
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
    <View style={[styles.payChip, { backgroundColor: color.primarySurface, borderRadius: radius.full }]}>
      <V2NavIcon name="qr" size={22} color={color.primary} strokeWidth={2.7} />
    </View>
  );
}

const styles = StyleSheet.create({
  // Visually larger than its neighbours (master spec: "visually larger
  // central QR action") and a perfect circle rather than the plain rounded
  // chip the other tabs implicitly have — the shape alone marks it as the
  // one non-symmetric tab before colour or size are read at all.
  payChip: { width: 48, height: 40, alignItems: 'center', justifyContent: 'center' },
});

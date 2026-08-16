import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../../app/theme/ThemeProvider';
import type { RootStackParamList } from '../../../app/navigation/types';
import { Screen } from '../../components/Screen';
import { Surface } from '../../components/Surface';
import { Button } from '../../components/Button';
import { DemoOnly } from '../../components/DemoOnly';
import { parsePartnerPayQr } from '../../utils/partnerPayQr';

/**
 * NEXT_CLAUDE_TASK.md requirement 1: scanning a partner's payment code opens
 * a `PurchaseIntent`, not the legacy `qrApi.redeem()` charge. The code
 * itself carries no amount and settles nothing by being scanned — it only
 * identifies which partner the customer is standing in front of. The
 * customer enters the amount (and, optionally, how much bonus to spend) on
 * `CreatePurchaseIntentScreen`; a cashier can only confirm or reject what
 * the customer entered — see that screen and
 * `apps/partner/.../purchase-intents/page.tsx` for the rest of the flow.
 *
 * `qrApi.redeem()` and the old confirm/receipt stages this screen used to
 * carry are gone from the *normal* flow, not deleted from the codebase —
 * the backend endpoint still exists for whatever legacy compatibility
 * needs it (`docs/NEXT_CLAUDE_TASK.md` requirement 10), it's just no longer
 * reachable from here.
 */
export function ScanQrScreen() {
  const { t } = useTranslation();
  const { color, space, text, radius, layout } = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [invalid, setInvalid] = useState(false);

  const handleScan = ({ data }: { data: string }) => {
    if (scanned) return;
    const parsed = parsePartnerPayQr(data);
    if (!parsed) {
      setInvalid(true);
      return;
    }
    setScanned(true);
    navigation.replace('CreatePurchaseIntent', { partnerId: parsed.partnerId });
  };

  const retry = () => {
    setInvalid(false);
    setScanned(false);
  };

  if (!permission) return <Screen title={t('qr.scanQr')}><View /></Screen>;

  if (!permission.granted) {
    return (
      <Screen title={t('qr.scanQr')}>
        <Surface style={{ alignItems: 'center', paddingVertical: space[8] }}>
          <View
            style={[
              styles.permIcon,
              { backgroundColor: color.primarySurface, borderRadius: radius.full },
            ]}
          >
            <Ionicons name="camera-outline" size={26} color={color.primary} />
          </View>
          <Text style={[text.headline, { color: color.textPrimary, marginTop: space[4] }]}>
            {t('qr.cameraTitle')}
          </Text>
          <Text
            style={[
              text.bodySm,
              { color: color.textSecondary, textAlign: 'center', marginTop: space[2], marginBottom: space[5] },
            ]}
          >
            {t('qr.cameraMessage')}
          </Text>
          <Button label={t('qr.allowCamera')} onPress={requestPermission} size="md" fullWidth={false} />
        </Surface>
      </Screen>
    );
  }

  if (invalid) {
    return (
      <Screen title={t('qr.scanQr')}>
        <Surface style={{ alignItems: 'center', paddingVertical: space[8] }}>
          <Ionicons name="alert-circle-outline" size={32} color={color.dangerText} />
          <Text
            style={[
              text.bodySm,
              { color: color.textSecondary, textAlign: 'center', marginTop: space[4] },
            ]}
          >
            {t('qr.invalidCode')}
          </Text>
        </Surface>
        <View style={{ marginTop: space[5] }}>
          <Button label={t('common.retry')} onPress={retry} variant="secondary" />
        </View>
      </Screen>
    );
  }

  return (
    <View style={[styles.flex, { backgroundColor: '#000' }]}>
      <CameraView
        style={StyleSheet.absoluteFill}
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={handleScan}
      />
      <SafeAreaView style={styles.flex}>
        <View style={[styles.scannerOverlay, { padding: layout.screenPaddingX }]}>
          {/* Corner brackets rather than a full frame: less visual weight,
              and they read as a target without obscuring the camera feed. */}
          <View style={styles.reticle}>
            {(['tl', 'tr', 'bl', 'br'] as const).map((corner) => (
              <View key={corner} style={[styles.corner, cornerStyle(corner)]} />
            ))}
          </View>
          <Text style={[text.body, styles.scanHint]}>{t('qr.scanHint')}</Text>

          {/* Only in the demonstration app, where there is no printed
              partner code to point a camera at. Renders nothing in any
              build that talks to a real API — see components/DemoOnly.tsx. */}
          <DemoOnly>
            <View style={styles.demoScan}>
              <Button
                label={t('qr.demoSimulateScan')}
                onPress={() => handleScan({ data: 'TUTAK-PAY:partner-sas' })}
                variant="secondary"
              />
            </View>
          </DemoOnly>
        </View>
      </SafeAreaView>
    </View>
  );
}

function cornerStyle(corner: 'tl' | 'tr' | 'bl' | 'br') {
  const w = 3;
  const base = { borderColor: '#FFFFFF' } as const;
  switch (corner) {
    case 'tl':
      return { ...base, top: 0, left: 0, borderTopWidth: w, borderLeftWidth: w, borderTopLeftRadius: 16 };
    case 'tr':
      return { ...base, top: 0, right: 0, borderTopWidth: w, borderRightWidth: w, borderTopRightRadius: 16 };
    case 'bl':
      return { ...base, bottom: 0, left: 0, borderBottomWidth: w, borderLeftWidth: w, borderBottomLeftRadius: 16 };
    default:
      return { ...base, bottom: 0, right: 0, borderBottomWidth: w, borderRightWidth: w, borderBottomRightRadius: 16 };
  }
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  demoScan: { width: '100%', marginTop: 24 },
  scannerOverlay: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  reticle: { width: 260, height: 260 },
  corner: { position: 'absolute', width: 40, height: 40 },
  scanHint: { color: '#FFFFFF', marginTop: 32, textAlign: 'center', opacity: 0.9 },
  permIcon: { width: 56, height: 56, alignItems: 'center', justifyContent: 'center' },
});

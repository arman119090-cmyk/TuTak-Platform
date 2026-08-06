import React, { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useAppTheme } from '../../../app/theme/ThemeProvider';
import { ScreenContainer } from '../../components/ScreenContainer';
import { Button } from '../../components/Button';
import { TextField } from '../../components/TextField';
import { qrApi } from '../../../data/api/qrApi';

export function ScanQrScreen() {
  const { t } = useTranslation();
  const { theme, spacing, typography, radius } = useAppTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const [scannedToken, setScannedToken] = useState<string | null>(null);
  const [amountToApply, setAmountToApply] = useState('');
  const [processing, setProcessing] = useState(false);

  const handleScan = ({ data }: { data: string }) => {
    if (!scannedToken) setScannedToken(data);
  };

  const handleConfirm = async () => {
    if (!scannedToken) return;
    setProcessing(true);
    try {
      const result = await qrApi.redeem({
        token: scannedToken,
        bonusAmountToApply: amountToApply || undefined,
        idempotencyKey: `${scannedToken}-${Date.now()}`,
      });
      Alert.alert(t('qr.paymentSuccess'), `${result.amountCharged} AMD`);
      setScannedToken(null);
      setAmountToApply('');
    } catch {
      Alert.alert(t('qr.paymentFailed'));
    } finally {
      setProcessing(false);
    }
  };

  if (!permission) {
    return <ScreenContainer><Text /></ScreenContainer>;
  }

  if (!permission.granted) {
    return (
      <ScreenContainer>
        <Text style={[typography.body, { color: theme.textPrimary, marginBottom: spacing.md }]}>
          {t('qr.scanQr')}
        </Text>
        <Button label={t('common.ok')} onPress={requestPermission} />
      </ScreenContainer>
    );
  }

  return (
    <View style={styles.flex}>
      {!scannedToken ? (
        <CameraView
          style={styles.flex}
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={handleScan}
        />
      ) : (
        <ScreenContainer>
          <Text style={[typography.title2, { color: theme.textPrimary, marginBottom: spacing.md }]}>
            {t('qr.confirmPayment')}
          </Text>
          <TextField
            label={t('qr.applyBonus')}
            value={amountToApply}
            onChangeText={setAmountToApply}
            keyboardType="decimal-pad"
            placeholder="0"
          />
          <Button label={t('qr.confirmPayment')} onPress={handleConfirm} loading={processing} />
          <View style={{ marginTop: spacing.md }}>
            <Button label={t('common.cancel')} variant="ghost" onPress={() => setScannedToken(null)} />
          </View>
        </ScreenContainer>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
});

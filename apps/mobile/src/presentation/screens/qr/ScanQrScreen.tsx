import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../../app/theme/ThemeProvider';
import { Screen } from '../../components/Screen';
import { Surface } from '../../components/Surface';
import { Button } from '../../components/Button';
import { Jako } from '../../components/Jako';
import { DemoOnly } from '../../components/DemoOnly';
import { qrApi } from '../../../data/api/qrApi';
import { describeApiError } from '../../../data/api/errors';
import { walletApi } from '../../../data/api/walletApi';
import { formatAmd, formatPoints } from '../../utils/format';

type Stage = 'scanning' | 'confirm' | 'success';

interface Receipt {
  amountCharged: string;
  bonusApplied: string;
  bonusEarned: string;
}

export function ScanQrScreen() {
  const { t } = useTranslation();
  const { color, space, text, radius, layout } = useTheme();
  const queryClient = useQueryClient();
  const [permission, requestPermission] = useCameraPermissions();

  const [stage, setStage] = useState<Stage>('scanning');
  const [token, setToken] = useState<string | null>(null);
  const [paymentKey, setPaymentKey] = useState<string | null>(null);
  const [applyBonus, setApplyBonus] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);

  const { data: wallet } = useQuery({ queryKey: ['wallet'], queryFn: walletApi.getMyWallet });
  // Kept as the decimal string the API returned. Number() round-trips lose
  // precision and can emit exponential notation, which the server rejects.
  const availableBonus = wallet?.availableBonus ?? '0';
  const hasBonus = Number(availableBonus) > 0;

  const handleScan = ({ data }: { data: string }) => {
    if (token) return;
    setToken(data);
    // One key per payment attempt, minted when the code is scanned and held
    // across retries. Deriving it from Date.now() at confirm time produced a
    // fresh key every tap, so the server's idempotency could never match and
    // a double-tap on a reusable merchant code charged twice.
    setPaymentKey(`${Date.now()}-${Math.random().toString(36).slice(2, 12)}`);
    setStage('confirm');
  };

  const handleConfirm = async () => {
    if (!token || !paymentKey) return;
    setProcessing(true);
    setError(null);
    try {
      const result = await qrApi.redeem({
        token,
        bonusAmountToApply: applyBonus && hasBonus ? availableBonus : undefined,
        idempotencyKey: paymentKey,
      });
      setReceipt(result);
      setStage('success');
      queryClient.invalidateQueries({ queryKey: ['wallet'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
    } catch (err) {
      // The server explains why a payment was refused — insufficient balance,
      // an expired code, a bonus larger than the bill. Swallowing that left
      // the customer with "payment failed" and no idea what to change.
      setError(describeApiError(err) ?? t('qr.paymentFailed'));
    } finally {
      setProcessing(false);
    }
  };

  const reset = () => {
    setToken(null);
    setPaymentKey(null);
    setReceipt(null);
    setApplyBonus(false);
    setError(null);
    setStage('scanning');
  };

  // ── Permission gate ───────────────────────────────────────────────────
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

  // ── Success receipt ───────────────────────────────────────────────────
  if (stage === 'success' && receipt) {
    return (
      <SafeAreaView style={[styles.flex, { backgroundColor: color.background }]}>
        <View style={[styles.successWrap, { padding: layout.screenPaddingX }]}>
          <View
            style={[
              styles.successMark,
              { backgroundColor: color.availableSurface, borderRadius: radius.full },
            ]}
          >
            <Ionicons name="checkmark" size={40} color={color.availableText} />
          </View>

          <Text style={[text.titleLg, { color: color.textPrimary, marginTop: space[6] }]}>
            {t('qr.paymentSuccess')}
          </Text>
          <Text style={[text.balanceSm, { color: color.textPrimary, marginTop: space[3] }]}>
            {formatAmd(receipt.amountCharged)}
          </Text>

          <Surface style={{ width: '100%', marginTop: space[8] }}>
            <ReceiptRow
              label={t('qr.applyBonus')}
              value={`−${formatPoints(receipt.bonusApplied)}`}
              tone={Number(receipt.bonusApplied) > 0 ? 'reserved' : 'muted'}
            />
            <View style={[styles.divider, { backgroundColor: color.border, marginVertical: space[3] }]} />
            <ReceiptRow
              label={t('bonus.earned')}
              value={`+${formatPoints(receipt.bonusEarned)}`}
              tone="available"
            />
          </Surface>

          <View style={{ width: '100%', marginTop: space[8], gap: space[3] }}>
            <Button label={t('common.done')} onPress={reset} />
          </View>

          <View style={{ marginTop: space[8], opacity: 0.35 }}>
            <Jako size={32} />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // ── Confirmation ──────────────────────────────────────────────────────
  if (stage === 'confirm') {
    return (
      <Screen title={t('qr.confirmPayment')} subtitle={t('qr.confirmSubtitle')}>
        <Surface>
          <Text style={[text.caption, { color: color.textSecondary }]}>{t('qr.merchantCode')}</Text>
          <Text
            style={[text.bodySm, { color: color.textPrimary, marginTop: space[1] }]}
            numberOfLines={1}
          >
            {token?.slice(0, 24)}…
          </Text>
        </Surface>

        {hasBonus ? (
          <Pressable onPress={() => setApplyBonus((v) => !v)} accessibilityRole="switch">
            <Surface style={{ marginTop: space[4] }}>
              <View style={styles.toggleRow}>
                <View style={styles.flex}>
                  <Text style={[text.body, { color: color.textPrimary }]}>
                    {t('qr.applyBonus')}
                  </Text>
                  <Text style={[text.caption, { color: color.textSecondary, marginTop: space[1] }]}>
                    {t('qr.availableToSpend', { amount: formatPoints(availableBonus) })}
                  </Text>
                </View>
                <View
                  style={[
                    styles.checkbox,
                    {
                      borderColor: applyBonus ? color.primary : color.borderStrong,
                      backgroundColor: applyBonus ? color.primary : 'transparent',
                      borderRadius: radius.sm,
                    },
                  ]}
                >
                  {applyBonus ? (
                    <Ionicons name="checkmark" size={16} color={color.textInverse} />
                  ) : null}
                </View>
              </View>
            </Surface>
          </Pressable>
        ) : null}

        {error ? (
          <Text style={[text.bodySm, { color: color.dangerText, marginTop: space[4] }]}>
            {error}
          </Text>
        ) : null}

        <View style={{ marginTop: space[7], gap: space[3] }}>
          <Button label={t('qr.confirmPayment')} onPress={handleConfirm} loading={processing} />
          <Button label={t('common.cancel')} onPress={reset} variant="tertiary" />
        </View>
      </Screen>
    );
  }

  // ── Scanner ───────────────────────────────────────────────────────────
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

          {/* Only in the demonstration app, where there is no merchant to
              issue a code and the walkthrough would otherwise stop here.
              Renders nothing in any build that talks to a real API — see
              components/DemoOnly.tsx. */}
          <DemoOnly>
            <View style={styles.demoScan}>
              <Button
                label={t('qr.demoSimulateScan')}
                onPress={() => handleScan({ data: 'TUTAK-DEMO-MERCHANT-CODE' })}
                variant="secondary"
              />
            </View>
          </DemoOnly>
        </View>
      </SafeAreaView>
    </View>
  );
}

function ReceiptRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'available' | 'reserved' | 'muted';
}) {
  const { color, text } = useTheme();
  const toneColor = {
    available: color.availableText,
    reserved: color.reservedText,
    muted: color.textSecondary,
  }[tone];

  return (
    <View style={styles.receiptRow}>
      <Text style={[text.bodySm, { color: color.textSecondary }]}>{label}</Text>
      <Text style={[text.headline, { color: toneColor }]}>{value}</Text>
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
  successWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  successMark: { width: 80, height: 80, alignItems: 'center', justifyContent: 'center' },
  receiptRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  divider: { height: StyleSheet.hairlineWidth },
  toggleRow: { flexDirection: 'row', alignItems: 'center' },
  checkbox: { width: 24, height: 24, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  permIcon: { width: 56, height: 56, alignItems: 'center', justifyContent: 'center' },
});

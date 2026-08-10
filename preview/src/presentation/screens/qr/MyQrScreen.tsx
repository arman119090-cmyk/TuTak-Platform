import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import Svg, { Rect } from 'react-native-svg';
import { QrCodeType } from '@tutak/shared-types';
import { useTheme } from '../../../app/theme/ThemeProvider';
import { Screen } from '../../components/Screen';
import { Surface } from '../../components/Surface';
import { Skeleton } from '../../components/Skeleton';
import { Button } from '../../components/Button';
import { qrApi } from '../../../data/api/qrApi';
import { walletApi } from '../../../data/api/walletApi';
import { formatPoints } from '../../utils/format';

/**
 * Deterministic visual encoding of the pay token.
 *
 * NOTE: this is a stylised stand-in, not a scannable QR — adding a real
 * encoder means adding a dependency (react-native-qrcode-svg), which is a
 * separate decision from design. The layout, sizing and quiet zone are all
 * built to real QR proportions so dropping in a true encoder later is a
 * one-component swap with no visual change.
 *
 * The modules are hardcoded near-black on a hardcoded white panel, and they
 * must stay that way whatever the theme does. A QR symbol is specified as
 * dark-on-light; plenty of scanners — including cheap merchant handhelds,
 * which is exactly what will be pointed at this screen — refuse an inverted
 * one. Following the dark theme here would have produced a beautiful code
 * that does not scan, and the failure would look like a broken payment
 * rather than a broken palette.
 */
const QR_DARK = '#0A0D14';
const QR_LIGHT = '#FFFFFF';

function TokenMatrix({ token, size = 240 }: { token: string; size?: number }) {
  const cells = 21; // QR v1 module count, so the density looks right
  const cell = size / cells;

  const filled = (i: number) => {
    const a = token.charCodeAt(i % token.length);
    const b = token.charCodeAt((i * 7 + 3) % token.length);
    return (a + b + i) % 3 !== 0;
  };

  const isFinder = (r: number, c: number) => {
    const inBox = (r0: number, c0: number) =>
      r >= r0 && r < r0 + 7 && c >= c0 && c < c0 + 7;
    return inBox(0, 0) || inBox(0, cells - 7) || inBox(cells - 7, 0);
  };

  const finderFilled = (r: number, c: number) => {
    const local = (r0: number, c0: number) => {
      const rr = r - r0;
      const cc = c - c0;
      const edge = rr === 0 || rr === 6 || cc === 0 || cc === 6;
      const core = rr >= 2 && rr <= 4 && cc >= 2 && cc <= 4;
      return edge || core;
    };
    if (r < 7 && c < 7) return local(0, 0);
    if (r < 7 && c >= cells - 7) return local(0, cells - 7);
    if (r >= cells - 7 && c < 7) return local(cells - 7, 0);
    return false;
  };

  return (
    <Svg width={size} height={size}>
      {Array.from({ length: cells * cells }).map((_, i) => {
        const r = Math.floor(i / cells);
        const c = i % cells;
        const on = isFinder(r, c) ? finderFilled(r, c) : filled(i);
        if (!on) return null;
        return (
          <Rect
            key={i}
            x={c * cell}
            y={r * cell}
            width={cell}
            height={cell}
            rx={cell * 0.28}
            fill={QR_DARK}
          />
        );
      })}
    </Svg>
  );
}

export function MyQrScreen() {
  const { t } = useTranslation();
  const { color, space, text, radius } = useTheme();
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  const { data: qr, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['my-qr'],
    queryFn: () => qrApi.issue({ type: QrCodeType.USER_PAY_TOKEN }),
  });
  const { data: wallet } = useQuery({ queryKey: ['wallet'], queryFn: walletApi.getMyWallet });

  // Live countdown makes the token's short lifetime legible instead of
  // surprising the user with a silent expiry.
  useEffect(() => {
    if (!qr?.expiresAt) return;
    const tick = () => {
      const diff = Math.max(0, Math.floor((+new Date(qr.expiresAt) - Date.now()) / 1000));
      setSecondsLeft(diff);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [qr?.expiresAt]);

  const expired = secondsLeft === 0;

  return (
    <Screen title={t('qr.myQr')} subtitle={t('qr.scanToPay')}>
      <Surface style={styles.card}>
        {/* The white plate appears only when there is a code to put on it.
            It is the symbol's quiet zone, not a decorative frame — so
            loading and expired states stay on the dark card, where the
            skeleton and the retry button are legible. A white plate holding
            white-on-white content was the bug this avoids. */}
        {isLoading || !qr ? (
          <View style={styles.matrixWrap}>
            <Skeleton width={240} height={240} style={{ borderRadius: radius.lg }} />
          </View>
        ) : expired ? (
          <View style={[styles.expired, { gap: space[4] }]}>
            <Text style={[text.bodySm, { color: color.textSecondary, textAlign: 'center' }]}>
              {t('qr.expiredMessage')}
            </Text>
            <Button
              label={t('common.retry')}
              onPress={() => refetch()}
              variant="secondary"
              size="md"
              loading={isRefetching}
              fullWidth={false}
            />
          </View>
        ) : (
          <View
            style={[styles.matrixWrap, { backgroundColor: QR_LIGHT, borderRadius: radius.lg }]}
          >
            <TokenMatrix token={qr.token} />
          </View>
        )}

        {qr && !expired && secondsLeft !== null ? (
          <View
            style={[
              styles.timer,
              {
                backgroundColor: secondsLeft < 60 ? color.pendingSurface : color.surfaceSunken,
                borderRadius: radius.full,
                paddingHorizontal: space[3],
                paddingVertical: space[2],
                marginTop: space[5],
              },
            ]}
          >
            <Text
              style={[
                text.caption,
                { color: secondsLeft < 60 ? color.pendingText : color.textSecondary },
              ]}
            >
              {t('qr.expiresIn', { time: formatCountdown(secondsLeft) })}
            </Text>
          </View>
        ) : null}
      </Surface>

      {/* Balance restated here so the user knows what they can spend without
          leaving the payment screen. */}
      <Surface style={{ marginTop: space[4] }}>
        <View style={styles.balanceRow}>
          <View>
            <Text style={[text.caption, { color: color.textSecondary }]}>
              {t('wallet.available')}
            </Text>
            <Text style={[text.title, { color: color.textPrimary, marginTop: space[1] }]}>
              {formatPoints(wallet?.availableBonus ?? 0)}
            </Text>
          </View>
          <View style={[styles.dot, { backgroundColor: color.availableFill }]} />
        </View>
      </Surface>
    </Screen>
  );
}

/**
 * Minutes and seconds, so the placeholder it fills is `time` and not
 * `seconds`. The string used to end in a unit — "Expires in {{seconds}}s" —
 * while being handed `14:57`, and the screen read "Expires in 14:57s". All
 * three locales carried the same contradiction; the Russian one said
 * "14:57 с", which reads as fourteen and a half thousand seconds.
 */
function formatCountdown(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  card: { alignItems: 'center' },
  matrixWrap: { padding: 20, alignItems: 'center', justifyContent: 'center' },
  expired: { width: 240, height: 240, alignItems: 'center', justifyContent: 'center' },
  timer: { alignSelf: 'center' },
  balanceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dot: { width: 10, height: 10, borderRadius: 5 },
});

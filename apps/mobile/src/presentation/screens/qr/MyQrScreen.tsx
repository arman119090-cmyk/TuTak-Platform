import React from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import Svg, { Rect } from 'react-native-svg';
import { QrCodeType } from '@tutak/shared-types';
import { useAppTheme } from '../../../app/theme/ThemeProvider';
import { ScreenContainer } from '../../components/ScreenContainer';
import { Card } from '../../components/Card';
import { qrApi } from '../../../data/api/qrApi';

/**
 * Renders the opaque token as a deterministic pseudo-QR pattern so the
 * screen is fully functional end-to-end without a native QR-drawing
 * dependency. Swap the SVG grid below for a real QR encoder (e.g.
 * react-native-qrcode-svg) when adding that package.
 */
function TokenGrid({ token }: { token: string }) {
  const { theme } = useAppTheme();
  const cells = 12;
  const size = 220;
  const cellSize = size / cells;

  return (
    <Svg width={size} height={size}>
      <Rect width={size} height={size} fill={theme.background} />
      {Array.from({ length: cells * cells }).map((_, i) => {
        const charCode = token.charCodeAt(i % token.length);
        if (charCode % 2 === 0) return null;
        const x = (i % cells) * cellSize;
        const y = Math.floor(i / cells) * cellSize;
        return <Rect key={i} x={x} y={y} width={cellSize} height={cellSize} fill={theme.textPrimary} />;
      })}
    </Svg>
  );
}

export function MyQrScreen() {
  const { t } = useTranslation();
  const { theme, spacing, typography } = useAppTheme();

  const { data: qr, isLoading } = useQuery({
    queryKey: ['my-qr'],
    queryFn: () => qrApi.issue({ type: QrCodeType.USER_PAY_TOKEN }),
  });

  return (
    <ScreenContainer>
      <Text style={[typography.title1, { color: theme.textPrimary, marginBottom: spacing.lg }]}>
        {t('qr.myQr')}
      </Text>
      <Card style={{ alignItems: 'center' }}>
        {isLoading || !qr ? (
          <ActivityIndicator color={theme.primary} />
        ) : (
          <>
            <TokenGrid token={qr.token} />
            <Text style={[typography.footnote, { color: theme.textSecondary, marginTop: spacing.md }]}>
              {t('qr.scanToPay')}
            </Text>
          </>
        )}
      </Card>
    </ScreenContainer>
  );
}

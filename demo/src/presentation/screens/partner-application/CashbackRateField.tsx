import React, { useMemo, useRef, useState } from 'react';
import { PanResponder, Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../../app/theme/ThemeProvider';
import { formatAmd, formatPoints } from '../../utils/format';

/** The grid the server enforces — `IsCommissionRateBps`. Nothing off it is accepted. */
export const MIN_RATE_BPS = 50;
export const MAX_RATE_BPS = 2000;
export const STEP_BPS = 50;

/**
 * Where the control opens, and the reason it is not the minimum.
 *
 * An applicant proposes their own rate and we would rather they proposed a
 * generous one — a higher rate ranks the partner ahead of nearer-equal
 * neighbours and earns a marker customers can see, so asking for it is a fair
 * trade rather than a favour. Almost nobody drags a control downwards from
 * where it opened, which makes the opening value the single strongest thing
 * on this screen. It is set high on purpose, and it can be moved anywhere on
 * the grid, including all the way down.
 */
export const DEFAULT_RATE_BPS = 1000;

/** The band drawn as recommended. Matches the server's own `HIGH_CASHBACK_PERCENT` at the low end. */
const RECOMMENDED_FROM_BPS = 500;
const RECOMMENDED_TO_BPS = 1000;

/** The basket the preview prices, in whole drams. A round, ordinary shop visit. */
const SAMPLE_BILL_AMD = 10000;

const clampToGrid = (bps: number): number => {
  const stepped = Math.round(bps / STEP_BPS) * STEP_BPS;
  return Math.min(MAX_RATE_BPS, Math.max(MIN_RATE_BPS, stepped));
};

/** 1000 -> "10", 1050 -> "10,5". The comma is the decimal mark in all three locales we ship. */
export const formatRate = (bps: number): string =>
  (bps % 100 === 0 ? String(bps / 100) : (bps / 100).toFixed(1)).replace('.', ',');

/**
 * The rate an applicant offers their customers.
 *
 * Built from a `PanResponder` over a plain `View` rather than a slider
 * package: this app carries no native module it can avoid — the same reason
 * the map is `<Image>` tiles — and a native dependency added here would make
 * the next build the first one to compile it. The buttons either side are not
 * decoration: they are how the value is set precisely, and how the control
 * works for someone who cannot drag.
 */
export function CashbackRateField({
  valueBps,
  onChange,
}: {
  valueBps: number;
  onChange: (bps: number) => void;
}) {
  const { t } = useTranslation();
  const { color, space, text, radius, bonusState } = useTheme();
  const [trackWidth, setTrackWidth] = useState(0);

  // Read inside the responder rather than captured at creation: the responder
  // is built once and would otherwise keep answering with the first value it
  // ever saw.
  const latest = useRef({ valueBps, trackWidth, onChange });
  latest.current = { valueBps, trackWidth, onChange };

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (event) => setFromX(event.nativeEvent.locationX),
        // From the touch's position on the track, not from an accumulated
        // delta: a drag that leaves the track and comes back should land
        // where the finger is, not where the arithmetic drifted to.
        onPanResponderMove: (event) => setFromX(event.nativeEvent.locationX),
      }),
    [],
  );

  function setFromX(x: number) {
    const { trackWidth: width, onChange: notify } = latest.current;
    if (width <= 0) return;
    const ratio = Math.min(1, Math.max(0, x / width));
    notify(clampToGrid(MIN_RATE_BPS + ratio * (MAX_RATE_BPS - MIN_RATE_BPS)));
  }

  const ratio = (valueBps - MIN_RATE_BPS) / (MAX_RATE_BPS - MIN_RATE_BPS);
  const recommendedLeft = (RECOMMENDED_FROM_BPS - MIN_RATE_BPS) / (MAX_RATE_BPS - MIN_RATE_BPS);
  const recommendedWidth =
    (RECOMMENDED_TO_BPS - RECOMMENDED_FROM_BPS) / (MAX_RATE_BPS - MIN_RATE_BPS);

  const points = Math.round((SAMPLE_BILL_AMD * valueBps) / 10000);
  const generous = valueBps >= RECOMMENDED_FROM_BPS;

  const step = (by: number) => onChange(clampToGrid(valueBps + by));

  return (
    <View
      style={{
        borderRadius: radius.lg,
        padding: space[4],
        marginBottom: space[6],
        backgroundColor: color.backgroundSubtle,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <Text style={[text.label, { color: color.textSecondary }]}>{t('becomePartner.rate')}</Text>
        <Text style={[text.balanceSm, { color: color.primary }]}>{formatRate(valueBps)}%</Text>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[3], marginTop: space[3] }}>
        <StepButton label="−" onPress={() => step(-STEP_BPS)} disabled={valueBps <= MIN_RATE_BPS} />

        <View
          style={{ flexGrow: 1, height: 44, justifyContent: 'center' }}
          onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}
          accessibilityRole="adjustable"
          accessibilityLabel={t('becomePartner.rate')}
          accessibilityValue={{ min: MIN_RATE_BPS / 100, max: MAX_RATE_BPS / 100, now: valueBps / 100 }}
          onAccessibilityAction={(e) =>
            step(e.nativeEvent.actionName === 'increment' ? STEP_BPS : -STEP_BPS)
          }
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          {...responder.panHandlers}
        >
          <View style={{ height: 6, borderRadius: 3, backgroundColor: color.border }}>
            <View
              style={{
                position: 'absolute',
                left: `${recommendedLeft * 100}%`,
                width: `${recommendedWidth * 100}%`,
                height: 6,
                borderRadius: 3,
                backgroundColor: bonusState.available.surface,
              }}
            />
            <View
              style={{
                width: `${ratio * 100}%`,
                height: 6,
                borderRadius: 3,
                backgroundColor: color.primary,
              }}
            />
          </View>
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: `${ratio * 100}%`,
              marginLeft: -14,
              width: 28,
              height: 28,
              borderRadius: 14,
              backgroundColor: color.primary,
              borderWidth: 3,
              borderColor: color.surface,
            }}
          />
        </View>

        <StepButton label="+" onPress={() => step(STEP_BPS)} disabled={valueBps >= MAX_RATE_BPS} />
      </View>

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: space[1] }}>
        <Text style={[text.caption, { color: color.textTertiary }]}>{t('becomePartner.rateFloor')}</Text>
        <Text style={[text.caption, { color: color.primary }]}>
          {t('becomePartner.rateRecommended')}
        </Text>
        <Text style={[text.caption, { color: color.textTertiary }]}>
          {t('becomePartner.rateCeiling')}
        </Text>
      </View>

      <Text
        style={[
          text.body,
          {
            color: color.textPrimary,
            marginTop: space[4],
            paddingTop: space[4],
            borderTopWidth: 1,
            borderTopColor: color.border,
          },
        ]}
      >
        {t('becomePartner.ratePreview', {
          bill: formatAmd(SAMPLE_BILL_AMD),
          points: formatPoints(points),
        })}
      </Text>

      {generous ? (
        <View
          style={{
            marginTop: space[3],
            padding: space[3],
            borderRadius: radius.md,
            backgroundColor: bonusState.available.surface,
          }}
        >
          <Text style={[text.caption, { color: bonusState.available.text }]}>
            {t('becomePartner.rateAdvantage')}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function StepButton({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled: boolean;
}) {
  const { color, radius, text } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{
        width: 44,
        height: 44,
        borderRadius: radius.md,
        backgroundColor: color.surface,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <Text style={[text.title, { color: color.textPrimary }]}>{label}</Text>
    </Pressable>
  );
}

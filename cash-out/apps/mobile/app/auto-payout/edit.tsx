import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import type { AutoPayoutCadence, AutoPayoutStateDto } from '@cashout/contracts';
import { endpoints } from '../../src/api/endpoints';
import { useAuth } from '../../src/auth/auth-context';
import { useErrorMessage } from '../../src/hooks/useErrorMessage';
import { useI18n } from '../../src/i18n/i18n';
import { useTheme } from '../../src/theme/theme';
import { Button, Card, Input, PinPad, Screen, SegmentedControl, Sheet, Text } from '../../src/ui';

const MINOR_PER_MAJOR = 100n;
const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;

/**
 * Editing the rule. Every bound on this screen — the smallest threshold, the
 * largest payout, the cadences offered — comes from the server's constraints;
 * nothing here is a business constant. Saving ends in the PIN: enabling a
 * standing instruction to move money is itself a money operation.
 */
export default function AutoPayoutEditScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { api } = useAuth();
  const { t, money, locale } = useI18n();
  const describeError = useErrorMessage();

  const [state, setState] = useState<AutoPayoutStateDto | null>(null);
  const [cadence, setCadence] = useState<AutoPayoutCadence>('ON_THRESHOLD');
  const [threshold, setThreshold] = useState('');
  const [maxPayout, setMaxPayout] = useState('');
  const [runHour, setRunHour] = useState('9');
  const [runWeekday, setRunWeekday] = useState<number>(1);
  const [error, setError] = useState<string | null>(null);
  const [pinOpen, setPinOpen] = useState(false);
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void endpoints
      .autoPayout(api)
      .then((next) => {
        setState(next);
        if (next.rule) {
          setCadence(next.rule.cadence);
          setThreshold((BigInt(next.rule.threshold.minor) / MINOR_PER_MAJOR).toString());
          setMaxPayout(
            next.rule.maxPayout
              ? (BigInt(next.rule.maxPayout.minor) / MINOR_PER_MAJOR).toString()
              : '',
          );
          setRunHour(String(next.rule.runHour ?? 9));
          setRunWeekday(next.rule.runWeekday ?? 1);
        } else {
          setThreshold((BigInt(next.constraints.minThreshold.minor) / MINOR_PER_MAJOR).toString());
        }
      })
      .catch((caught: unknown) => setError(describeError(caught)));
  }, [api, describeError]);

  const currency = state?.constraints.minThreshold.currency ?? 'AMD';
  const thresholdMinor = threshold ? BigInt(threshold) * MINOR_PER_MAJOR : 0n;
  const maxMinor = maxPayout ? BigInt(maxPayout) * MINOR_PER_MAJOR : null;
  const minThreshold = state ? BigInt(state.constraints.minThreshold.minor) : 0n;
  const maxAllowed = state ? BigInt(state.constraints.maxPayout.minor) : 0n;
  const hour = Number(runHour);

  const thresholdOk = thresholdMinor >= minThreshold;
  const maxOk = maxMinor === null || (maxMinor >= minThreshold && maxMinor <= maxAllowed);
  const hourOk = cadence === 'ON_THRESHOLD' || (Number.isInteger(hour) && hour >= 0 && hour <= 23);
  const valid = !!state && thresholdOk && maxOk && hourOk;

  const save = async (pinValue: string) => {
    setBusy(true);
    setPinError(null);
    try {
      const authorization = await endpoints.authorize(api, {
        method: 'PIN',
        pin: pinValue,
        purpose: 'AUTO_PAYOUT',
      });
      await endpoints.upsertAutoPayout(api, {
        cadence,
        threshold: { minor: thresholdMinor.toString(), currency: currency as never },
        ...(maxMinor !== null
          ? { maxPayout: { minor: maxMinor.toString(), currency: currency as never } }
          : {}),
        ...(cadence !== 'ON_THRESHOLD' ? { runHour: hour } : {}),
        ...(cadence === 'WEEKLY' ? { runWeekday } : {}),
        authorizationToken: authorization.authorizationToken,
      });
      setPinOpen(false);
      router.back();
    } catch (caught) {
      setPinError(describeError(caught));
      setShake((n) => n + 1);
      setPin('');
    } finally {
      setBusy(false);
    }
  };

  const weekdayName = (day: number) =>
    new Intl.DateTimeFormat(locale === 'hy' ? 'hy-AM' : locale === 'ru' ? 'ru-RU' : 'en-US', {
      weekday: 'short',
    }).format(new Date(Date.UTC(2026, 8, 20 + day)));

  return (
    <Screen
      footer={
        <View style={{ gap: theme.spacing.sm }}>
          <Button
            label={t('autoPayout.save')}
            onPress={() => {
              setPin('');
              setPinError(null);
              setPinOpen(true);
            }}
            disabled={!valid}
          />
          <Button label={t('common.cancel')} variant="ghost" onPress={() => router.back()} />
        </View>
      }
    >
      <View style={{ paddingTop: theme.spacing.xl, paddingBottom: theme.spacing.base }}>
        <Text variant="titleLarge">{t('autoPayout.editTitle')}</Text>
      </View>

      <Text variant="label" tone="secondary" style={{ marginBottom: theme.spacing.sm }}>
        {t('autoPayout.when')}
      </Text>
      <SegmentedControl
        segments={[
          { value: 'ON_THRESHOLD', label: t('autoPayout.cadenceOnThreshold') },
          { value: 'DAILY', label: t('autoPayout.cadenceDaily') },
          { value: 'WEEKLY', label: t('autoPayout.cadenceWeekly') },
        ]}
        value={cadence}
        onChange={setCadence}
      />

      <View style={{ marginTop: theme.spacing.lg, gap: theme.spacing.md }}>
        <Input
          label={t('autoPayout.threshold')}
          hint={
            state
              ? t('autoPayout.thresholdHint', { min: money(state.constraints.minThreshold) })
              : undefined
          }
          value={threshold}
          onChangeText={(next) => setThreshold(next.replace(/\D/g, ''))}
          keyboardType="number-pad"
          error={threshold && !thresholdOk ? t('autoPayout.belowMinimum') : null}
        />
        <Input
          label={t('autoPayout.maxPayout')}
          hint={
            state
              ? t('autoPayout.maxPayoutHint', { max: money(state.constraints.maxPayout) })
              : undefined
          }
          value={maxPayout}
          onChangeText={(next) => setMaxPayout(next.replace(/\D/g, ''))}
          keyboardType="number-pad"
          placeholder={t('autoPayout.everything')}
          error={maxPayout && !maxOk ? t('autoPayout.outOfRange') : null}
        />
        {cadence !== 'ON_THRESHOLD' ? (
          <Input
            label={t('autoPayout.runHour')}
            value={runHour}
            onChangeText={(next) => setRunHour(next.replace(/\D/g, '').slice(0, 2))}
            keyboardType="number-pad"
            error={!hourOk ? t('autoPayout.hourInvalid') : null}
          />
        ) : null}
        {cadence === 'WEEKLY' ? (
          <View>
            <Text variant="label" tone="secondary" style={{ marginBottom: theme.spacing.sm }}>
              {t('autoPayout.runWeekday')}
            </Text>
            <SegmentedControl
              segments={WEEKDAYS.map((day) => ({ value: String(day), label: weekdayName(day) }))}
              value={String(runWeekday)}
              onChange={(next) => setRunWeekday(Number(next))}
            />
          </View>
        ) : null}
      </View>

      <Card tone="muted" style={{ marginTop: theme.spacing.lg }}>
        <Text variant="caption" tone="secondary">
          {t('autoPayout.pipelineNote')}
        </Text>
      </Card>

      {error ? (
        <Text variant="caption" tone="danger" style={{ marginTop: theme.spacing.base }}>
          {error}
        </Text>
      ) : null}

      <Sheet
        visible={pinOpen}
        onClose={() => (busy ? undefined : setPinOpen(false))}
        dismissable={!busy}
        title={t('autoPayout.confirmTitle')}
      >
        <Text
          variant="body"
          tone="secondary"
          align="center"
          style={{ marginBottom: theme.spacing.base }}
        >
          {t('autoPayout.confirmBody')}
        </Text>
        <PinPad
          value={pin}
          onChange={(next) => {
            setPin(next);
            setPinError(null);
          }}
          onComplete={(value) => void save(value)}
          disabled={busy}
          error={pinError}
          shake={shake}
        />
      </Sheet>
    </Screen>
  );
}

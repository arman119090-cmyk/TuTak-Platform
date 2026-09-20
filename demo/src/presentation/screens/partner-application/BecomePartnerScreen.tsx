import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import { useMutation } from '@tanstack/react-query';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { PartnerCategory } from '@tutak/shared-types';
import { Screen } from '../../components/Screen';
import { TextField } from '../../components/TextField';
import { Button } from '../../components/Button';
import { JakoHero } from '../../components/JakoHero';
import { JakoWingMark } from '../../components/V2NavIcon';
import { partnersApi } from '../../../data/api/partnersApi';
import { describeApiError } from '../../../data/api/errors';
import { useTheme } from '../../../app/theme/ThemeProvider';
import { CATEGORY_ORDER } from '../partners/categories';
import { CashbackRateField, DEFAULT_RATE_BPS } from './CashbackRateField';
import type { RootStackParamList } from '../../../app/navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'BecomePartner'>;

/**
 * The three steps a business walks through before its application is
 * filed: why join, who you are, what you offer. The fourth state of the
 * journey — filed — is `PartnerApplicationSentScreen`.
 */
type Step = 'welcome' | 'details' | 'offer';
const STEPS: Step[] = ['welcome', 'details', 'offer'];

/**
 * Where a business asks to join.
 *
 * `POST /partners/apply` has existed since the platform was written — it
 * creates the partner awaiting approval, makes the applicant its owner, and
 * records the whole thing — and no client ever called it. A business could
 * not ask to join from anywhere, and partners had to be created by hand by an
 * administrator who first needed the owner's user id.
 *
 * The form asks for exactly what the server takes and nothing else. ՀՎՀՀ is
 * optional here because it is optional there: this is first contact with a
 * business that has agreed to nothing, and a required tax number at that
 * moment loses the applicant rather than producing the number.
 *
 * ## One screen, three steps
 *
 * The brand brief (20.09.2026) splits the journey into welcome → details →
 * offer → submitted, each with its own Jako. That is done here as one
 * screen with a `step` in state rather than three routes: the draft lives
 * in this component either way, nothing is sent until the last step, and a
 * route per step would mean threading five fields through navigation
 * params for no benefit. The request, its payload and the server's answers
 * are exactly what the single-page form sent — only the order in which the
 * questions are asked has changed.
 */
export function BecomePartnerScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const { color, space, text, radius, premium } = useTheme();

  const [step, setStep] = useState<Step>('welcome');
  const [legalName, setLegalName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [taxId, setTaxId] = useState('');
  const [category, setCategory] = useState<PartnerCategory>(PartnerCategory.GROCERY);
  const [rateBps, setRateBps] = useState(DEFAULT_RATE_BPS);
  const [error, setError] = useState<string | null>(null);

  const submit = useMutation({
    mutationFn: () =>
      partnersApi.apply({
        legalName: legalName.trim(),
        displayName: displayName.trim(),
        ...(taxId.trim() ? { taxId: taxId.trim() } : {}),
        category,
        bonusAccrualRateBps: rateBps,
      }),
    onSuccess: () =>
      // Replaced, not pushed: going "back" to a form whose application has
      // already been filed would invite sending it twice.
      navigation.replace('PartnerApplicationSent', {
        displayName: displayName.trim(),
        category,
        rateBps,
        ...(taxId.trim() ? { taxId: taxId.trim() } : {}),
      }),
    onError: (err) => {
      // The server refuses a second application while one is still waiting,
      // and says so in English. That refusal is a normal thing for a person
      // to run into — they came back to the form to check — so it is said in
      // their own language rather than relayed.
      const status = axios.isAxiosError(err) ? err.response?.status : undefined;
      if (status === 409) {
        setError(t('becomePartner.alreadyApplied'));
        return;
      }
      setError(describeApiError(err) ?? t('becomePartner.failed'));
    },
  });

  // The server's own minimum for both names. Checked here so the button is
  // honest about whether pressing it can work, not to replace that check.
  const detailsComplete = legalName.trim().length >= 2 && displayName.trim().length >= 2;
  const canSubmit = detailsComplete && !submit.isPending;

  const stepIndex = STEPS.indexOf(step);
  const back = () => {
    if (step === 'welcome') navigation.goBack();
    else setStep(STEPS[stepIndex - 1]);
  };

  return (
    <Screen title={t('becomePartner.title')}>
      {step !== 'welcome' ? (
        <Text style={[text.caption, { color: color.textTertiary, marginBottom: space[2] }]}>
          {t('becomePartner.stepOf', { n: stepIndex, total: STEPS.length - 1 })}
        </Text>
      ) : null}

      {step === 'welcome' ? (
        <View>
          {/* The invitation: why join, in three lines, and one button. Jako
              greets with a raised wing; nothing to fill in yet. */}
          <JakoHero state="partner-welcome" />
          <Text style={[text.titleLg, { color: color.textPrimary, marginTop: space[5] }]}>
            {t('becomePartner.welcomeTitle')}
          </Text>
          <Text style={[text.body, { color: color.textSecondary, marginTop: space[2] }]}>
            {t('becomePartner.welcomeBody')}
          </Text>
          <View style={{ marginTop: space[5], gap: space[3] }}>
            {(['welcomePoint1', 'welcomePoint2', 'welcomePoint3'] as const).map((key) => (
              <View key={key} style={styles.point}>
                <Ionicons name="checkmark-circle" size={20} color={color.primary} />
                <Text style={[text.body, styles.pointText, { color: color.textPrimary }]}>
                  {t(`becomePartner.${key}`)}
                </Text>
              </View>
            ))}
          </View>
          <View style={{ marginTop: space[7] }}>
            <Button
              label={t('becomePartner.start')}
              onPress={() => setStep('details')}
              icon={<JakoWingMark size={16} color={color.textInverse} />}
            />
          </View>
        </View>
      ) : null}

      {step === 'details' ? (
        <View>
          <JakoHero state="partner-details" size="compact" align="start" style={{ marginBottom: space[3] }} />
          <Text style={[text.title, { color: color.textPrimary }]}>{t('becomePartner.detailsTitle')}</Text>
          <Text style={[text.bodySm, { color: color.textSecondary, marginTop: space[1], marginBottom: space[5] }]}>
            {t('becomePartner.detailsBody')}
          </Text>

          <TextField
            label={t('becomePartner.legalName')}
            value={legalName}
            onChangeText={setLegalName}
            placeholder={t('becomePartner.legalNamePlaceholder')}
            maxLength={200}
          />
          <TextField
            label={t('becomePartner.displayName')}
            value={displayName}
            onChangeText={setDisplayName}
            placeholder={t('becomePartner.displayNamePlaceholder')}
            hint={t('becomePartner.displayNameHint')}
            maxLength={100}
          />
          <TextField
            label={t('becomePartner.taxId')}
            value={taxId}
            onChangeText={setTaxId}
            placeholder={t('becomePartner.taxIdPlaceholder')}
            hint={t('common.optional')}
            keyboardType="number-pad"
            maxLength={30}
          />

          <View style={[styles.actions, { gap: space[3], marginTop: space[2] }]}>
            <View style={styles.actionSecondary}>
              <Button label={t('common.back')} onPress={back} variant="secondary" />
            </View>
            <View style={styles.actionPrimary}>
              <Button
                label={t('common.next')}
                onPress={() => setStep('offer')}
                disabled={!detailsComplete}
                icon={<JakoWingMark size={16} color={color.textInverse} />}
              />
            </View>
          </View>
        </View>
      ) : null}

      {step === 'offer' ? (
        <View>
          <JakoHero state="partner-offer" size="compact" align="start" style={{ marginBottom: space[3] }} />
          <Text style={[text.title, { color: color.textPrimary }]}>{t('becomePartner.offerTitle')}</Text>
          <Text style={[text.bodySm, { color: color.textSecondary, marginTop: space[1], marginBottom: space[5] }]}>
            {t('becomePartner.offerBody')}
          </Text>

          <Text style={[text.label, { color: color.textSecondary, marginBottom: space[2] }]}>
            {t('becomePartner.category')}
          </Text>
          {/* The same pill as the map's filter strip: one geometry for
              "pick one of these" across the app. Quiet at rest, brand green
              when chosen, no border either way. */}
          <View style={[styles.chips, { gap: space[2], marginBottom: space[6] }]}>
            {CATEGORY_ORDER.map((value) => {
              const selected = value === category;
              return (
                <Pressable
                  key={value}
                  onPress={() => setCategory(value)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  style={({ pressed }) => [
                    styles.chip,
                    {
                      paddingHorizontal: space[4],
                      borderRadius: radius.full,
                      backgroundColor: selected
                        ? premium.brand.primary
                        : pressed
                          ? color.fillSubtlePressed
                          : color.backgroundSubtle,
                    },
                  ]}
                >
                  <Text
                    style={[
                      text.bodySm,
                      { color: selected ? color.textInverse : color.textPrimary, fontWeight: selected ? '600' : '500' },
                    ]}
                  >
                    {t(`partnerCategory.${value}`)}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <CashbackRateField valueBps={rateBps} onChange={setRateBps} />

          {error ? (
            <Text style={[text.caption, { color: color.dangerFill, marginBottom: space[4] }]}>
              {error}
            </Text>
          ) : null}

          <View style={[styles.actions, { gap: space[3] }]}>
            <View style={styles.actionSecondary}>
              <Button label={t('common.back')} onPress={back} variant="secondary" disabled={submit.isPending} />
            </View>
            <View style={styles.actionPrimary}>
              <Button
                label={t('becomePartner.submit')}
                onPress={() => {
                  setError(null);
                  submit.mutate();
                }}
                loading={submit.isPending}
                disabled={!canSubmit}
                icon={<JakoWingMark size={16} color={color.textInverse} />}
              />
            </View>
          </View>
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  point: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  pointText: { flex: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap' },
  chip: { minHeight: 40, justifyContent: 'center' },
  actions: { flexDirection: 'row' },
  actionSecondary: { flex: 2 },
  actionPrimary: { flex: 3 },
});

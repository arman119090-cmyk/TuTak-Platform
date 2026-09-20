import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import { useMutation } from '@tanstack/react-query';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { PartnerCategory } from '@tutak/shared-types';
import { TextField } from '../../components/TextField';
import { Button } from '../../components/Button';
import { JakoScene } from '../../components/JakoScene';
import { DataSafeNote } from '../../components/DataSafeNote';
import { JakoWingMark } from '../../components/V2NavIcon';
import { partnersApi } from '../../../data/api/partnersApi';
import { describeApiError } from '../../../data/api/errors';
import { useTheme } from '../../../app/theme/ThemeProvider';
import { CATEGORY_ORDER } from '../partners/categories';
import { CashbackRateField, DEFAULT_RATE_BPS } from './CashbackRateField';
import type { RootStackParamList } from '../../../app/navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'BecomePartner'>;

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
 * One page, as the owner's reference has it (20.09.2026): Jako greeting at
 * the top, the three fields, the category, the cashback, one button. A
 * three-step version of this form was tried and rejected the same day — a
 * shop owner filling this in on a phone wants to see the whole ask at once.
 * The filed state is `PartnerApplicationSentScreen`.
 */
export function BecomePartnerScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const { color, space, text, radius, premium } = useTheme();

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
  const canSubmit = legalName.trim().length >= 2 && displayName.trim().length >= 2 && !submit.isPending;

  return (
    <JakoScene
      state="partner-welcome"
      title={t('becomePartner.title')}
      subtitle={t('becomePartner.intro')}
      note={t('scene.note.login')}
      bubble={t('scene.bubble')}
    >
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

      <Text style={[text.label, { color: color.textSecondary, marginBottom: space[2] }]}>
        {t('becomePartner.category')}
      </Text>
      {/* Pills: white with a hairline at rest, brand green when chosen. The
          hairline is what lets an unchosen pill read as a choice on a white
          sheet — a borderless grey pill there looks like a disabled tag. */}
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
                  borderColor: selected ? premium.brand.primary : color.border,
                  backgroundColor: selected ? premium.brand.primary : pressed ? color.fillSubtlePressed : color.surface,
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
        <Text style={[text.caption, { color: color.dangerFill, marginBottom: space[4] }]}>{error}</Text>
      ) : null}

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
      <DataSafeNote />
    </JakoScene>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap' },
  chip: { minHeight: 44, justifyContent: 'center', borderWidth: 1 },
});

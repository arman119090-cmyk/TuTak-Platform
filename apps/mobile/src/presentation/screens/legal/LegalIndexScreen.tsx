import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../../app/theme/ThemeProvider';
import { Screen } from '../../components/Screen';
import { ListRow } from '../../components/ListRow';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { legalApi } from '../../../data/api/legalApi';
import { useAuthStore } from '../../../data/stores/authStore';
import type { RootStackParamList } from '../../../app/navigation/types';
import {
  LEGAL_DOCUMENT_LANGUAGES,
  LegalDocumentLanguage,
  legalLanguageForInterface,
} from './LegalDocumentLanguage';

const LANGUAGE_LABELS: Record<LegalDocumentLanguage, string> = { ru: 'Русский', hy: 'Հայերեն' };

/**
 * "Правовая информация": the five documents, in one place, reachable with or
 * without an account.
 *
 * Three states, and each is honest about itself:
 *
 * - the texts are published → the list, in the language the person reads;
 * - the interface is English → the documents do not exist in English, so the
 *   screen says so and offers the two languages they do exist in, rather than
 *   serving Russian under an English label;
 * - the publication gate is closed → "not published yet", which is the truth
 *   and is better than a page full of `{{OPERATOR_LEGAL_NAME}}`.
 */
export function LegalIndexScreen() {
  const { t, i18n } = useTranslation();
  const { color, space, text } = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [chosen, setChosen] = useState<LegalDocumentLanguage | null>(null);

  const language = chosen ?? legalLanguageForInterface(i18n.language);

  const index = useQuery({
    queryKey: ['legal', 'index', language],
    queryFn: () => legalApi.index(language!),
    enabled: language !== null,
    retry: false,
  });

  /*
   * The edition this person accepted, when there is a person.
   *
   * "Ранее принятые редакции доступны для сохранения" is a promise the terms
   * make, and a promise needs a door: when the accepted revision is not the
   * current one, the list offers to open exactly the copy that was accepted,
   * from the archive, hash and all. Absent before sign-in — there is nothing
   * to look up — and absent for accounts that registered before the texts
   * existed, which have no record and are never told they "accepted" one.
   */
  const signedIn = useAuthStore((s) => s.user !== null);
  const mine = useQuery({
    queryKey: ['legal', 'consents', 'me'],
    queryFn: () => legalApi.myConsents(),
    enabled: signedIn && language !== null,
    retry: false,
  });
  const accepted = mine.data?.consents.find((entry) => entry.granted)?.revision ?? null;
  const acceptedIsOlder = accepted !== null && index.data !== undefined && accepted !== index.data.revision;

  if (!language) {
    return (
      <Screen title={t('legal.sectionTitle')} subtitle={t('legal.languageNotice')}>
        <Text style={[text.label, { color: color.textPrimary, marginBottom: space[2] }]}>
          {t('legal.languageChoiceTitle')}
        </Text>
        {LEGAL_DOCUMENT_LANGUAGES.map((candidate) => (
          <View key={candidate} style={{ marginTop: space[2] }}>
            <Button
              label={LANGUAGE_LABELS[candidate]}
              variant="secondary"
              onPress={() => setChosen(candidate)}
            />
          </View>
        ))}
      </Screen>
    );
  }

  return (
    <Screen title={t('legal.sectionTitle')} subtitle={t('legal.indexSubtitle')}>
      {index.isError ? (
        <EmptyState
          title={t('legal.notPublished')}
          message={t('legal.notPublishedExplain')}
        />
      ) : null}

      {index.data?.isDraft ? (
        <View
          testID="legal-draft-banner"
          style={[styles.banner, { backgroundColor: color.pendingSurface, padding: space[3], gap: space[2] }]}
        >
          <Ionicons name="alert-circle-outline" size={18} color={color.textSecondary} />
          <Text style={[text.caption, styles.flex, { color: color.textSecondary }]}>
            {t('legal.draftBanner')}
          </Text>
        </View>
      ) : null}

      {(index.data?.documents ?? []).map((document, i, all) => (
        <ListRow
          key={document.key}
          title={t(`legal.docs.${document.key}`, { defaultValue: document.title })}
          subtitle={t('legal.revision', { revision: document.revision })}
          trailing={<Ionicons name="chevron-forward" size={18} color={color.borderStrong} />}
          onPress={() =>
            navigation.navigate('LegalDocument', {
              documentKey: document.key,
              language,
              title: t(`legal.docs.${document.key}`, { defaultValue: document.title }),
            })
          }
          last={i === all.length - 1}
        />
      ))}

      {accepted ? (
        <View testID="legal-accepted-edition" style={{ marginTop: space[4] }}>
          <Text style={[text.caption, { color: color.textSecondary }]}>
            {t('legal.acceptedEdition', { revision: accepted })}
          </Text>
          {acceptedIsOlder ? (
            <>
              <Text style={[text.caption, { color: color.textTertiary, marginTop: space[1] }]}>
                {t('legal.currentEditionNote')}
              </Text>
              <View style={{ marginTop: space[2] }}>
                <Button
                  label={t('legal.acceptedEditionOpen')}
                  variant="secondary"
                  onPress={() =>
                    navigation.navigate('LegalDocument', {
                      documentKey: 'terms',
                      language,
                      revision: accepted,
                      title: t('legal.docs.terms'),
                    })
                  }
                />
              </View>
            </>
          ) : null}
        </View>
      ) : null}

      {index.data ? (
        <Text style={[text.caption, { color: color.textTertiary, marginTop: space[4] }]}>
          {t('legal.languageNotice')}
        </Text>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  banner: { flexDirection: 'row', alignItems: 'flex-start', borderRadius: 12 },
  flex: { flex: 1 },
});

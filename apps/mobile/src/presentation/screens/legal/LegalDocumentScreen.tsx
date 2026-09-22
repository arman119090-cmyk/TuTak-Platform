import React from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../../app/theme/ThemeProvider';
import { Screen } from '../../components/Screen';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { legalApi } from '../../../data/api/legalApi';
import type { RootStackParamList } from '../../../app/navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'LegalDocument'>;

/**
 * One legal text, in full, on a phone.
 *
 * Deliberately plain: the document is Markdown as published, and the hash
 * under it is taken over exactly those bytes, so this screen renders the
 * structure (headings, paragraphs) without rewriting a single character. The
 * edition and the checksum are shown because they are what a saved copy is
 * checked against later, and "Сохранить копию" hands over that same file
 * rather than a re-rendered summary of it.
 *
 * `Screen` already gives the back arrow, the safe areas and the scroll; the
 * registration form stays mounted underneath, so coming back here loses
 * nothing that was typed.
 */
export function LegalDocumentScreen({ route }: Props) {
  const { documentKey, language, title, revision } = route.params;
  const { t } = useTranslation();
  const { color, space, text } = useTheme();

  const document = useQuery({
    queryKey: ['legal', 'document', documentKey, language, revision ?? 'current'],
    queryFn: () => legalApi.document(documentKey, language, revision),
    retry: false,
  });

  if (document.isError) {
    return (
      <Screen title={title ?? t('legal.sectionTitle')}>
        <EmptyState
          title={t('legal.loadFailed')}
          message={t('legal.notPublishedExplain')}
          actionLabel={t('legal.retry')}
          onAction={() => void document.refetch()}
        />
      </Screen>
    );
  }

  const data = document.data;

  return (
    <Screen title={title ?? data?.title ?? t('legal.sectionTitle')}>
      {data?.isDraft ? (
        <View
          testID="legal-draft-banner"
          style={[styles.banner, { backgroundColor: color.pendingSurface, padding: space[3], gap: space[2] }]}
        >
          <Ionicons name="alert-circle-outline" size={18} color={color.pendingText} />
          <Text style={[text.caption, styles.flex, { color: color.pendingText }]}>
            {t('legal.draftBanner')}
          </Text>
        </View>
      ) : null}

      {data
        ? renderMarkdown(data.content).map((block, i) => (
            <Text
              key={`${block.kind}-${i}`}
              selectable
              style={[
                block.kind === 'heading' ? text.label : text.bodySm,
                {
                  color: block.kind === 'heading' ? color.textPrimary : color.textSecondary,
                  marginTop: block.kind === 'heading' ? space[4] : space[2],
                },
              ]}
            >
              {block.value}
            </Text>
          ))
        : null}

      {data ? (
        <View style={{ marginTop: space[6] }}>
          <Text style={[text.caption, { color: color.textTertiary }]}>
            {t('legal.revision', { revision: data.revision })}
          </Text>
          <Text style={[text.caption, { color: color.textTertiary, marginTop: space[1] }]}>
            {t('legal.checksum', { hash: data.contentHash })}
          </Text>
          <View style={{ marginTop: space[3] }}>
            <Button
              label={t('legal.saveCopy')}
              variant="secondary"
              onPress={() => {
                void Linking.openURL(legalApi.fileUrl(documentKey, language, data.revision));
              }}
            />
          </View>
        </View>
      ) : null}
    </Screen>
  );
}

/**
 * The little of Markdown these documents use: `#`-headings and paragraphs.
 *
 * A full Markdown renderer is a dependency and a risk for texts that contain
 * neither images nor links; what matters legally is that every character of
 * the source appears, which is why the heading case strips only the leading
 * hashes and nothing else.
 */
export function renderMarkdown(source: string): Array<{ kind: 'heading' | 'paragraph'; value: string }> {
  return source
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0)
    .map((block) =>
      block.startsWith('#')
        ? { kind: 'heading' as const, value: block.replace(/^#+\s*/, '') }
        : { kind: 'paragraph' as const, value: block },
    );
}

const styles = StyleSheet.create({
  banner: { flexDirection: 'row', alignItems: 'flex-start', borderRadius: 12 },
  flex: { flex: 1 },
});

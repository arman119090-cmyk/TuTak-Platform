import React from 'react';
import { FlatList, Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { NotificationDto } from '@tutak/shared-types';
import { useAppTheme } from '../../../app/theme/ThemeProvider';
import { ScreenContainer } from '../../components/ScreenContainer';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { notificationsApi } from '../../../data/api/notificationsApi';

function NotificationRow({ item }: { item: NotificationDto }) {
  const { theme, spacing, typography } = useAppTheme();
  const { t } = useTranslation();
  return (
    <Card style={{ marginBottom: spacing.sm, opacity: item.isRead ? 0.6 : 1 }}>
      <Text style={[typography.callout, { color: theme.textPrimary }]}>{t(item.titleKey)}</Text>
      <Text style={[typography.footnote, { color: theme.textSecondary, marginTop: spacing.xs }]}>
        {t(item.bodyKey, item.params ?? undefined)}
      </Text>
    </Card>
  );
}

export function NotificationsScreen() {
  const { t } = useTranslation();
  const { theme, spacing, typography } = useAppTheme();
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ['notifications'], queryFn: () => notificationsApi.myNotifications() });

  const handleMarkAllRead = async () => {
    await notificationsApi.markAllRead();
    queryClient.invalidateQueries({ queryKey: ['notifications'] });
  };

  return (
    <ScreenContainer scroll={false}>
      <Text style={[typography.title1, { color: theme.textPrimary, marginBottom: spacing.sm }]}>
        {t('notifications.title')}
      </Text>
      <Button label={t('notifications.markAllRead')} variant="ghost" onPress={handleMarkAllRead} />
      <FlatList
        data={data?.items ?? []}
        keyExtractor={(n) => n.id}
        renderItem={({ item }) => <NotificationRow item={item} />}
        contentContainerStyle={{ marginTop: spacing.sm }}
        ListEmptyComponent={
          <Text style={[typography.body, { color: theme.textSecondary }]}>{t('notifications.empty')}</Text>
        }
      />
    </ScreenContainer>
  );
}

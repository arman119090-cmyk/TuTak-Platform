import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../../app/theme/ThemeProvider';
import { Screen } from '../../components/Screen';
import { Surface } from '../../components/Surface';
import { EmptyState } from '../../components/EmptyState';
import { Skeleton } from '../../components/Skeleton';
import { notificationsApi } from '../../../data/api/notificationsApi';
import { formatDateTime } from '../../utils/format';

export function NotificationsScreen() {
  const { t } = useTranslation();
  const { color, space, text, radius } = useTheme();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => notificationsApi.myNotifications(),
  });

  const items = data?.items ?? [];
  const unread = items.filter((n) => !n.isRead).length;

  const markAllRead = async () => {
    await notificationsApi.markAllRead();
    queryClient.invalidateQueries({ queryKey: ['notifications'] });
  };

  const markRead = async (id: string) => {
    await notificationsApi.markRead(id);
    queryClient.invalidateQueries({ queryKey: ['notifications'] });
  };

  return (
    <Screen
      title={t('notifications.title')}
      headerAccessory={
        unread > 0 ? (
          <Pressable onPress={markAllRead} hitSlop={8}>
            <Text style={[text.label, { color: color.primary }]}>
              {t('notifications.markAllRead')}
            </Text>
          </Pressable>
        ) : undefined
      }
    >
      {isLoading ? (
        <View style={{ gap: space[3] }}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} width="100%" height={76} style={{ borderRadius: radius.xl }} />
          ))}
        </View>
      ) : items.length === 0 ? (
        <Surface>
          <EmptyState title={t('notifications.empty')} message={t('notifications.emptyMessage')} />
        </Surface>
      ) : (
        items.map((n) => (
          <Pressable key={n.id} onPress={() => (n.isRead ? undefined : markRead(n.id))}>
            <Surface style={{ marginBottom: space[3] }}>
              <View style={styles.row}>
                {/* Unread is signalled by a brand dot, not a tinted card —
                    the list stays calm and the dot does the work. */}
                <View
                  style={[
                    styles.iconWrap,
                    {
                      backgroundColor: n.isRead ? color.surfaceSunken : color.primarySurface,
                      borderRadius: radius.md,
                    },
                  ]}
                >
                  <Ionicons
                    name="notifications"
                    size={18}
                    color={n.isRead ? color.textTertiary : color.primary}
                  />
                </View>

                <View style={[styles.flex, { marginLeft: space[3] }]}>
                  <View style={styles.titleRow}>
                    <Text
                      style={[
                        n.isRead ? text.body : text.headline,
                        { color: color.textPrimary, flex: 1 },
                      ]}
                      numberOfLines={1}
                    >
                      {t(n.titleKey, { defaultValue: n.titleKey })}
                    </Text>
                    {!n.isRead ? (
                      <View style={[styles.unreadDot, { backgroundColor: color.primary }]} />
                    ) : null}
                  </View>
                  <Text
                    style={[text.bodySm, { color: color.textSecondary, marginTop: space[1] }]}
                    numberOfLines={2}
                  >
                    {t(n.bodyKey, { ...(n.params ?? {}), defaultValue: n.bodyKey })}
                  </Text>
                  <Text style={[text.caption, { color: color.textTertiary, marginTop: space[2] }]}>
                    {formatDateTime(n.createdAt)}
                  </Text>
                </View>
              </View>
            </Surface>
          </Pressable>
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  iconWrap: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  unreadDot: { width: 8, height: 8, borderRadius: 4 },
});

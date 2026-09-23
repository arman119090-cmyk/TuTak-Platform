import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTheme } from '../../../app/theme/ThemeProvider';
import { Screen } from '../../components/Screen';
import { EmptyState } from '../../components/EmptyState';
import { Skeleton } from '../../components/Skeleton';
import { notificationsApi } from '../../../data/api/notificationsApi';
import { formatAmd, formatDateTime } from '../../utils/format';

/**
 * The stored parameters, as a person reads them.
 *
 * A payment notification is stored with the raw figures — `type:
 * "QR_PAYMENT"`, `amount: "1500.0000"` — so the app can re-render it in any
 * language. Passed straight into the sentence they printed exactly that:
 * "Операция QR_PAYMENT на сумму 1500.0000 выполнена." The type gets the same
 * label the history screen uses, and the amount the same formatting.
 */
export function readableParams(
  params: Record<string, unknown> | null | undefined,
  t: (key: string, options?: Record<string, unknown>) => string,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(params ?? {}) };
  if (typeof out.type === 'string') {
    out.type = t(`transactionType.${out.type}`, { defaultValue: out.type });
  }
  if (typeof out.amount === 'string' || typeof out.amount === 'number') {
    out.amount = formatAmd(String(out.amount));
  }
  return out;
}

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
            <Skeleton key={i} width="100%" height={64} style={{ borderRadius: radius.md }} />
          ))}
        </View>
      ) : items.length === 0 ? (
        <EmptyState title={t('notifications.empty')} message={t('notifications.emptyMessage')} />
      ) : (
        items.map((n, i) => (
          <Pressable
            key={n.id}
            onPress={() => (n.isRead ? undefined : markRead(n.id))}
            accessibilityRole="button"
            style={({ pressed }) => ({ opacity: pressed && !n.isRead ? 0.7 : 1 })}
          >
            {/* One row per notification, straight on the page. Unread is the
                heavier title and a brand dot; read is the lighter title. No
                card and no icon tile — the list is the calm part of the app,
                and every row carrying the same bell said nothing. */}
            <View style={[styles.row, { paddingVertical: space[4] }]}>
              <View style={styles.flex}>
                <View style={styles.titleRow}>
                  <Text
                    style={[n.isRead ? text.body : text.headline, { color: color.textPrimary, flex: 1 }]}
                    numberOfLines={2}
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
                  {t(n.bodyKey, { ...readableParams(n.params, t), defaultValue: n.bodyKey })}
                </Text>
                <Text style={[text.caption, { color: color.textTertiary, marginTop: space[2] }]}>
                  {formatDateTime(n.createdAt)}
                </Text>
              </View>
            </View>
            {i === items.length - 1 ? null : (
              <View style={[styles.separator, { backgroundColor: color.divider }]} />
            )}
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
  separator: { height: StyleSheet.hairlineWidth },
  unreadDot: { width: 8, height: 8, borderRadius: 4 },
});

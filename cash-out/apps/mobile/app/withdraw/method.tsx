import React, { useCallback, useState } from 'react';
import { View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import type { PayoutMethodDto } from '@cashout/contracts';
import { endpoints } from '../../src/api/endpoints';
import { useAuth } from '../../src/auth/auth-context';
import { useErrorMessage } from '../../src/hooks/useErrorMessage';
import { useI18n } from '../../src/i18n/i18n';
import { useTheme } from '../../src/theme/theme';
import { Button, Card, Dialog, EmptyState, ListRow, Screen, Sheet, Text } from '../../src/ui';

/**
 * Payout methods.
 *
 * "Add a card" opens the payment provider's own sheet; card details never reach
 * this app's memory, let alone its server. The provider hands back a one-time
 * token and that is all that is sent. Until a provider is chosen the sheet
 * explains exactly that, rather than presenting a card form that would be a lie
 * about where the data goes.
 */
export default function PayoutMethodScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { api } = useAuth();
  const { t } = useI18n();
  const describeError = useErrorMessage();

  const [methods, setMethods] = useState<PayoutMethodDto[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [removing, setRemoving] = useState<PayoutMethodDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setMethods((await endpoints.payoutMethods(api)).items);
    } catch (caught) {
      setError(describeError(caught));
    }
  }, [api, describeError]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return (
    <Screen
      footer={<Button label={t('payoutMethod.addCard')} onPress={() => setAddOpen(true)} />}
    >
      <View style={{ paddingTop: theme.spacing.xl, paddingBottom: theme.spacing.base }}>
        <Text variant="titleLarge">{t('withdraw.methodTitle')}</Text>
      </View>

      {methods.length === 0 ? (
        <EmptyState title={t('withdraw.noMethods')} glyph="💳" />
      ) : (
        <Card padded={false}>
          {methods.map((method, index) => (
            <ListRow
              key={method.id}
              label={`${method.displayName ?? ''} ${method.maskedIdentifier}`.trim()}
              value={
                method.isDefault
                  ? t('payoutMethod.makeDefault')
                  : method.status === 'PENDING_VERIFICATION'
                    ? t('payoutMethod.pendingVerification')
                    : method.status === 'REJECTED'
                      ? t('payoutMethod.rejected')
                      : undefined
              }
              onPress={() => setRemoving(method)}
              first={index === 0}
              last={index === methods.length - 1}
            />
          ))}
        </Card>
      )}

      {error ? (
        <Text variant="caption" tone="danger" style={{ marginTop: theme.spacing.base }}>
          {error}
        </Text>
      ) : null}

      <Sheet visible={addOpen} onClose={() => setAddOpen(false)} title={t('payoutMethod.addCard')}>
        <Text variant="body" tone="secondary">
          {t('withdraw.noMethods')}
        </Text>
        <Text variant="caption" tone="tertiary" style={{ marginTop: theme.spacing.sm }}>
          Card details are collected by the payment provider’s own secure sheet. Cash Out never
          sees or stores a card number. This step is wired to the provider’s SDK; until a provider
          is contracted, there is nothing here to enter.
        </Text>
        <Button
          label={t('common.close')}
          variant="secondary"
          onPress={() => setAddOpen(false)}
          style={{ marginTop: theme.spacing.base }}
        />
      </Sheet>

      <Dialog
        visible={removing !== null}
        title={t('payoutMethod.removeConfirm')}
        body={removing?.maskedIdentifier}
        confirmLabel={t('payoutMethod.remove')}
        cancelLabel={t('common.cancel')}
        destructive
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          const target = removing;
          setRemoving(null);
          if (!target) return;
          void endpoints
            .removePayoutMethod(api, target.id)
            .then(load)
            .catch((caught: unknown) => setError(describeError(caught)));
        }}
      />
    </Screen>
  );
}

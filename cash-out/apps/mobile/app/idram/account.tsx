import React, { useCallback, useState } from 'react';
import { View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import type { PayoutMethodDto } from '@cashout/contracts';
import { endpoints } from '../../src/api/endpoints';
import { useAuth } from '../../src/auth/auth-context';
import { useErrorMessage } from '../../src/hooks/useErrorMessage';
import { useI18n } from '../../src/i18n/i18n';
import { useTheme } from '../../src/theme/theme';
import { Button, Card, Dialog, IdramCard, Input, Screen, Sheet, Text } from '../../src/ui';

/**
 * Settings → iDram account: link, replace, unlink.
 *
 * The account id is typed once, sent once, and never shown again; the server
 * answers with the masked form and the verification state. A rejected id links
 * nothing, and the message says why.
 */
export default function IdramAccountScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { api } = useAuth();
  const { t } = useI18n();
  const describeError = useErrorMessage();

  const [account, setAccount] = useState<PayoutMethodDto | null | undefined>(undefined);
  const [formOpen, setFormOpen] = useState(false);
  const [unlinkOpen, setUnlinkOpen] = useState(false);
  const [accountId, setAccountId] = useState('');
  const [holderName, setHolderName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setAccount((await endpoints.idramAccount(api)).account);
    } catch (caught) {
      setError(describeError(caught));
    }
  }, [api, describeError]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const linked = await endpoints.linkIdram(api, {
        accountId: accountId.trim(),
        ...(holderName.trim() ? { holderName: holderName.trim() } : {}),
      });
      setAccount(linked);
      setFormOpen(false);
      setAccountId('');
      setHolderName('');
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      footer={
        <View style={{ gap: theme.spacing.sm }}>
          <Button
            label={account ? t('idram.replace') : t('idram.link')}
            onPress={() => {
              setError(null);
              setFormOpen(true);
            }}
          />
          <Button label={t('common.back')} variant="ghost" onPress={() => router.back()} />
        </View>
      }
    >
      <View style={{ paddingTop: theme.spacing.xl, paddingBottom: theme.spacing.base }}>
        <Text variant="titleLarge">{t('idram.title')}</Text>
        <Text variant="body" tone="secondary" style={{ marginTop: theme.spacing.xs }}>
          {t('idram.subtitle')}
        </Text>
      </View>

      <IdramCard account={account ?? null} />

      {account ? (
        <Button
          label={t('idram.unlink')}
          variant="ghost"
          onPress={() => setUnlinkOpen(true)}
          style={{ marginTop: theme.spacing.sm }}
        />
      ) : null}

      {error && !formOpen ? (
        <Card tone="muted" style={{ marginTop: theme.spacing.base }}>
          <Text variant="body" tone="danger">
            {error}
          </Text>
        </Card>
      ) : null}

      <Sheet
        visible={formOpen}
        onClose={() => (busy ? undefined : setFormOpen(false))}
        dismissable={!busy}
        title={t('idram.linkTitle')}
        footer={
          <View style={{ gap: theme.spacing.sm }}>
            <Button
              label={account ? t('idram.replace') : t('idram.link')}
              onPress={() => void submit()}
              loading={busy}
              disabled={accountId.trim().length < 5}
            />
            <Button
              label={t('common.cancel')}
              variant="ghost"
              disabled={busy}
              onPress={() => setFormOpen(false)}
            />
          </View>
        }
      >
        <Text variant="body" tone="secondary">
          {t('idram.linkBody')}
        </Text>
        <View style={{ marginTop: theme.spacing.base, gap: theme.spacing.md }}>
          <Input
            label={t('idram.accountId')}
            value={accountId}
            onChangeText={(next) => {
              setAccountId(next);
              setError(null);
            }}
            keyboardType="default"
            autoCapitalize="none"
            autoCorrect={false}
            error={error}
          />
          <Input label={t('idram.holderName')} value={holderName} onChangeText={setHolderName} />
        </View>
      </Sheet>

      <Dialog
        visible={unlinkOpen}
        title={t('idram.unlinkConfirm')}
        body={account?.maskedIdentifier}
        confirmLabel={t('idram.unlink')}
        cancelLabel={t('common.cancel')}
        destructive
        onCancel={() => setUnlinkOpen(false)}
        onConfirm={() => {
          setUnlinkOpen(false);
          void endpoints
            .unlinkIdram(api)
            .then(load)
            .catch((caught: unknown) => setError(describeError(caught)));
        }}
      />
    </Screen>
  );
}

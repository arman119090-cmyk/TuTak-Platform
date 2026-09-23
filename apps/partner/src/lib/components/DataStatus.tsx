'use client';

import { useTranslation } from 'react-i18next';
import { Button } from '@tutak/design/web';
import { clockTime } from '../queryState';

/** Shown in place of content the server has not answered about yet. */
export function LoadingNotice({ label }: { label?: string }) {
  const { t } = useTranslation();
  return (
    <p role="status" className="py-6 text-[13px] text-faint">
      {label ?? t('partnerPanel.common.loading')}
    </p>
  );
}

/**
 * Shown instead of content when nothing has arrived. Never an empty state:
 * "no purchases" and "could not load purchases" need opposite next steps.
 */
export function LoadError({
  title,
  onRetry,
  busy,
}: {
  title: string;
  onRetry: () => void;
  busy?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded-lg border border-danger-text/30 p-4">
      <p className="text-[13px] font-medium text-danger-text">{title}</p>
      <p className="text-[12px] text-muted">{t('partnerPanel.notice.loadErrorBody')}</p>
      <Button variant="secondary" size="sm" loading={busy} onClick={onRetry}>
        {t('partnerPanel.notice.tryAgain')}
      </Button>
    </div>
  );
}

/**
 * Shown instead of content the server refused.
 *
 * Deliberately without a retry: a 403 is an answer, not a failure, and a
 * button that re-asks the same question of the same account only teaches
 * people the app is unreliable. What it says instead is who can see this,
 * because that is the next step the person actually has.
 */
export function AccessRefused({ title, message }: { title: string; message: string }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-2 rounded-lg border border-subtle p-4">
      <p className="text-[13px] font-medium text-ink">{title}</p>
      <p className="text-[12px] text-muted">{message}</p>
    </div>
  );
}

/**
 * Shown above content that arrived once and has stopped refreshing.
 *
 * The figures stay on screen — they were true at `asOf` — but a person
 * acting on them has to know they may be old. A purchase queue that quietly
 * froze looks exactly like a quiet afternoon.
 */
export function StaleNotice({
  asOf,
  what,
  onRetry,
  busy,
}: {
  asOf: number;
  what: string;
  onRetry: () => void;
  busy?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div
      role="alert"
      className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-pending/40 bg-pending-surface px-4 py-2 text-[12px] text-pending-text"
    >
      <span>{t('partnerPanel.notice.stale', { what, time: clockTime(asOf) })}</span>
      <Button variant="secondary" size="sm" loading={busy} onClick={onRetry}>
        {t('partnerPanel.notice.refresh')}
      </Button>
    </div>
  );
}

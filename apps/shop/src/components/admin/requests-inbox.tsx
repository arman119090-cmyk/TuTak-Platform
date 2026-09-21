'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { RequestStatus, RequestType } from '@prisma/client';
import { formatMoney } from '@/lib/money';
import { formatDateTime } from '@/lib/utils';
import { Button, Select, Textarea } from '@/components/ui';
import { Panel } from './ui';
import { cn } from '@/lib/utils';

export type RequestView = {
  id: string;
  type: RequestType;
  status: RequestStatus;
  name: string;
  phone: string;
  email: string | null;
  comment: string | null;
  payload: Record<string, unknown>;
  adminNote: string | null;
  createdAt: string;
  productName: string | null;
};

const TYPE_LABELS: Record<RequestType, string> = {
  KITCHEN: 'Кухня',
  MEASUREMENT: 'Замер',
  DOOR: 'Дверь',
  CALLBACK: 'Обратный звонок',
  CUSTOM_SIZE: 'Индивидуальный размер',
  PRICE_REQUEST: 'Запрос цены',
  CONSULTATION: 'Консультация',
};

const STATUS_LABELS: Record<RequestStatus, string> = {
  NEW: 'Новая',
  IN_PROGRESS: 'В работе',
  DONE: 'Закрыта',
  REJECTED: 'Отклонена',
};

/** Readable rendering of the type-specific answers stored on a request. */
const PayloadView = ({ payload }: { payload: Record<string, unknown> }) => {
  const entries = Object.entries(payload).filter(([, value]) => value !== '' && value !== null);
  if (entries.length === 0) return null;
  return (
    <dl className="mt-2 grid gap-x-4 gap-y-1 text-[12px] sm:grid-cols-2">
      {entries.map(([key, value]) => (
        <div key={key} className="flex gap-2">
          <dt className="text-muted">{key}</dt>
          <dd>
            {key.toLowerCase().includes('minor') && typeof value === 'number'
              ? formatMoney(value)
              : String(value)}
          </dd>
        </div>
      ))}
    </dl>
  );
};

export const RequestsInbox = ({ requests }: { requests: RequestView[] }) => {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const update = async (request: RequestView, status: RequestStatus) => {
    setBusy(request.id);
    await fetch(`/api/admin/requests/${request.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status, adminNote: notes[request.id] ?? request.adminNote ?? '' }),
    });
    setBusy(null);
    router.refresh();
  };

  if (requests.length === 0) {
    return <Panel><p className="p-5 text-[13px] text-muted">Заявок нет.</p></Panel>;
  }

  return (
    <div className="space-y-3">
      {requests.map((request) => (
        <Panel key={request.id}>
          <div className="flex flex-wrap items-start gap-3 border-b border-line px-4 py-3">
            <span className="rounded-full bg-surface-2 px-2.5 py-1 text-[12px]">
              {TYPE_LABELS[request.type]}
            </span>
            <span
              className={cn(
                'rounded-full px-2.5 py-1 text-[12px]',
                request.status === 'NEW'
                  ? 'bg-[#FBF3E2] text-[#7A5A12]'
                  : request.status === 'IN_PROGRESS'
                    ? 'bg-[#E8EEF4] text-[#33526F]'
                    : request.status === 'DONE'
                      ? 'bg-success-soft text-success'
                      : 'bg-[#FBEAE8] text-[#8F2C23]',
              )}
            >
              {STATUS_LABELS[request.status]}
            </span>
            <span className="ml-auto text-[12px] text-muted">
              {formatDateTime(request.createdAt, 'ru')}
            </span>
          </div>

          <div className="grid gap-4 p-4 lg:grid-cols-[1.4fr_1fr]">
            <div>
              <p className="text-[14px] font-medium">
                {request.name} ·{' '}
                <a href={`tel:${request.phone}`} className="text-accent hover:underline">
                  {request.phone}
                </a>
                {request.email ? <span className="text-muted"> · {request.email}</span> : null}
              </p>
              {request.productName ? (
                <p className="mt-1 text-[13px] text-muted">Товар: {request.productName}</p>
              ) : null}
              {request.comment ? <p className="mt-2 text-[13px]">{request.comment}</p> : null}
              <PayloadView payload={request.payload} />
              {request.adminNote ? (
                <p className="mt-3 rounded-[var(--radius-sm)] bg-surface-2 p-2 text-[12px] text-muted">
                  Заметка: {request.adminNote}
                </p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Textarea
                placeholder="Заметка менеджера"
                value={notes[request.id] ?? request.adminNote ?? ''}
                onChange={(event) => setNotes({ ...notes, [request.id]: event.target.value })}
                className="min-h-16"
              />
              <div className="flex gap-2">
                <Select
                  value={request.status}
                  onChange={(event) => update(request, event.target.value as RequestStatus)}
                  disabled={busy === request.id}
                >
                  {(Object.keys(STATUS_LABELS) as RequestStatus[]).map((status) => (
                    <option key={status} value={status}>
                      {STATUS_LABELS[status]}
                    </option>
                  ))}
                </Select>
                <Button
                  variant="secondary"
                  onClick={() => update(request, request.status)}
                  disabled={busy === request.id}
                >
                  Сохранить
                </Button>
              </div>
            </div>
          </div>
        </Panel>
      ))}
    </div>
  );
};

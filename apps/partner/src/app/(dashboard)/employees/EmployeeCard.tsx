'use client';

import { useQuery } from '@tanstack/react-query';
import { Trans, useTranslation } from 'react-i18next';
import { Badge, Surface, Table, Td, Th, Tr } from '@tutak/design/web';
import type { AxiosError } from 'axios';
import { partnerApi } from '@/lib/api/partnerApi';
import { dataStateOf } from '@/lib/queryState';
import { LoadError, LoadingNotice, StaleNotice } from '@/lib/components/DataStatus';

const day = (iso: string) => new Date(iso).toISOString().slice(0, 10);

const statusOf = (error: unknown): number | undefined =>
  (error as AxiosError | undefined)?.response?.status;

/**
 * Who a permanent employee code belongs to.
 *
 * The code is what a statement line and a confirmed purchase carry, and the
 * partner reading either one needs a person. It is deliberately the only
 * place in the panel that turns one into the other — a name printed on every
 * row would be more personal data on more screens than the rows need.
 *
 * Three answers, kept apart because they need opposite next steps. A card is
 * an answer. A 404 means the code does not resolve *for this account*, which
 * is not the same as saying it does not exist — the server answers "no such
 * code" and "not yours to resolve" identically on purpose, so this screen
 * must not claim to know which. Anything else is a failure to load, and says
 * so rather than showing an empty card.
 */
export function EmployeeCard({ partnerId, code }: { partnerId: string; code: string }) {
  const { t } = useTranslation();
  const query = useQuery({
    queryKey: ['partner-employee', partnerId, code],
    queryFn: () => partnerApi.employeeCard(partnerId, code),
    enabled: Boolean(partnerId && code),
    // A code resolves or it does not; retrying a refusal four times only
    // delays telling the person that.
    retry: (count, error) => statusOf(error) !== 404 && statusOf(error) !== 403 && count < 2,
  });

  const state = dataStateOf(query);
  const status = statusOf(query.error);

  if (state === 'loading') return <LoadingNotice label={t('partnerPanel.employees.looking')} />;

  if (state === 'error' && (status === 404 || status === 403)) {
    return (
      <Surface>
        {/* The code is a component inside the sentence rather than a
            separate line: where it sits in the sentence differs by language,
            and the monospaced run has to travel with it. */}
        <p role="status" className="text-[13px] text-muted">
          <Trans
            i18nKey="partnerPanel.employees.unresolved"
            values={{ code }}
            components={[<span key="code" className="font-mono tracking-[0.15em] text-ink" />]}
          />
        </p>
      </Surface>
    );
  }

  if (state === 'error') {
    return (
      <LoadError
        title={t('partnerPanel.employees.lookupFailed')}
        onRetry={() => void query.refetch()}
        busy={query.isFetching}
      />
    );
  }

  const card = query.data!;

  return (
    <div className="flex flex-col gap-4">
      {state === 'stale' && (
        <StaleNotice
          asOf={query.dataUpdatedAt}
          what={t('partnerPanel.employees.staleCard')}
          onRetry={() => void query.refetch()}
          busy={query.isFetching}
        />
      )}

      <Surface>
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h2 className="text-[20px] font-semibold text-ink">
            {card.firstName} {card.lastName}
          </h2>
          <span className="font-mono text-[14px] tracking-[0.2em] text-faint">{card.code}</span>
        </div>
        <p className="mt-2 text-[12px] text-muted">
          {t('partnerPanel.employees.personCodeNote')}
        </p>
        {card.roles.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {card.roles.map((r) => (
              <Badge key={r.role} tone={r.allBranches ? 'available' : 'neutral'}>
                {r.role.replace(/_/g, ' ').toLowerCase()}
                {r.allBranches ? t('partnerPanel.employees.allBranches') : ''}
              </Badge>
            ))}
          </div>
        )}
      </Surface>

      <Surface>
        <h3 className="mb-3 text-[13px] font-semibold text-ink">
          {t('partnerPanel.employees.branches')}
        </h3>
        {card.assignments.length === 0 ? (
          // Not an error and not an empty organisation: an owner or an
          // all-branch manager acts without being posted anywhere.
          <p className="text-[13px] text-muted">{t('partnerPanel.employees.notPostedCard')}</p>
        ) : (
          <Table>
            <thead>
              <Tr>
                <Th>{t('partnerPanel.employees.branch')}</Th>
                <Th>{t('partnerPanel.employees.role')}</Th>
                <Th>{t('partnerPanel.employees.from')}</Th>
                <Th>{t('partnerPanel.employees.statusColumn')}</Th>
              </Tr>
            </thead>
            <tbody>
              {card.assignments.map((a) => (
                <Tr key={`${a.branchId}-${a.assignedAt}`}>
                  <Td>
                    <span className="text-ink">{a.branchName}</span>
                    <span className="block text-[12px] text-faint">{a.branchAddress}</span>
                  </Td>
                  <Td className="text-muted">{a.role.replace(/_/g, ' ').toLowerCase()}</Td>
                  <Td className="tabular text-muted">{day(a.assignedAt)}</Td>
                  <Td>
                    {a.isActive ? (
                      <Badge tone="available">{t('partnerPanel.employees.workingHere')}</Badge>
                    ) : (
                      <Badge tone="neutral">
                        {a.deactivatedAt
                          ? t('partnerPanel.employees.endedOn', { date: day(a.deactivatedAt) })
                          : t('partnerPanel.employees.ended')}
                      </Badge>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Surface>
    </div>
  );
}

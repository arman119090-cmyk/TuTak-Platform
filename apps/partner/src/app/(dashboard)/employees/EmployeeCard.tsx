'use client';

import { useQuery } from '@tanstack/react-query';
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

  if (state === 'loading') return <LoadingNotice label="Looking up the code…" />;

  if (state === 'error' && (status === 404 || status === 403)) {
    return (
      <Surface>
        <p role="status" className="text-[13px] text-muted">
          <span className="font-mono tracking-[0.15em] text-ink">{code}</span> does not resolve
          for your account. Either no such employee code exists at your organisation, or it
          belongs to a branch you are not assigned to. Your owner account can look it up.
        </p>
      </Surface>
    );
  }

  if (state === 'error') {
    return <LoadError title="Could not look up this code." onRetry={() => void query.refetch()} busy={query.isFetching} />;
  }

  const card = query.data!;

  return (
    <div className="flex flex-col gap-4">
      {state === 'stale' && (
        <StaleNotice
          asOf={query.dataUpdatedAt}
          what="this employee card"
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
          This code stays with this person for as long as they work here. Moving them between
          branches does not change it, and it is never given to anybody else.
        </p>
        {card.roles.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {card.roles.map((r) => (
              <Badge key={r.role} tone={r.allBranches ? 'available' : 'neutral'}>
                {r.role.replace(/_/g, ' ').toLowerCase()}
                {r.allBranches ? ' · all branches' : ''}
              </Badge>
            ))}
          </div>
        )}
      </Surface>

      <Surface>
        <h3 className="mb-3 text-[13px] font-semibold text-ink">Branches</h3>
        {card.assignments.length === 0 ? (
          // Not an error and not an empty organisation: an owner or an
          // all-branch manager acts without being posted anywhere.
          <p className="text-[13px] text-muted">
            Not posted to a specific branch. Their reach comes from their role, not from a
            posting.
          </p>
        ) : (
          <Table>
            <thead>
              <Tr>
                <Th>Branch</Th>
                <Th>Role</Th>
                <Th>From</Th>
                <Th>Status</Th>
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
                      <Badge tone="available">Working here</Badge>
                    ) : (
                      <Badge tone="neutral">
                        Ended{a.deactivatedAt ? ` ${day(a.deactivatedAt)}` : ''}
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

'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { Badge, Button, Field, Input, PageHeader, Surface, Table, Td, Th, Tr } from '@tutak/design/web';
import { getPrimaryPartnerId, isPartnerOwner, useAuthStore } from '@/lib/stores/authStore';
import { partnerApi } from '@/lib/api/partnerApi';
import { dataStateOf } from '@/lib/queryState';
import { LoadError, LoadingNotice, StaleNotice } from '@/lib/components/DataStatus';
import { InvitationsCard } from './InvitationsCard';

/**
 * Who works here.
 *
 * A list of people rather than of postings: somebody working two branches is
 * one person with two places, and the permanent code is what makes that
 * sayable. The branch roster answers the other question — who works at this
 * branch — and lives with the branch.
 */
export default function EmployeesPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const partnerId = getPrimaryPartnerId(user);
  const isOwner = isPartnerOwner(user, partnerId);
  const [code, setCode] = useState('');
  const trimmed = code.trim().toUpperCase();

  const people = useQuery({
    queryKey: ['partner-employees', partnerId],
    queryFn: () => partnerApi.listEmployees(partnerId!),
    enabled: Boolean(partnerId),
  });

  const branches = useQuery({
    queryKey: ['partner-branches', partnerId],
    queryFn: () => partnerApi.listBranches(partnerId!),
    enabled: Boolean(partnerId) && isOwner,
  });

  const state = dataStateOf(people);

  return (
    <>
      <PageHeader
        title="Employees"
        description="Everyone who works at your organisation, and the code each of them appears under on receipts and statements."
      />

      <div className="flex flex-col gap-4">
        <Surface>
          <h3 className="text-[15px] font-semibold text-ink">Your people</h3>

          {state === 'loading' ? <LoadingNotice label="Loading employees…" /> : null}
          {state === 'error' ? (
            <LoadError
              title="Could not load your employees."
              onRetry={() => void people.refetch()}
              busy={people.isFetching}
            />
          ) : null}
          {state === 'stale' ? (
            <StaleNotice
              asOf={people.dataUpdatedAt}
              what="this employee list"
              onRetry={() => void people.refetch()}
              busy={people.isFetching}
            />
          ) : null}

          {state !== 'loading' && state !== 'error' ? (
            (people.data ?? []).length === 0 ? (
              <p className="mt-2 text-[13px] text-faint">
                Nobody yet. Invite somebody below — they get a code by SMS and join themselves.
              </p>
            ) : (
              <div className="mt-4">
                <Table>
                  <thead>
                    <Tr>
                      <Th>Code</Th>
                      <Th>Name</Th>
                      <Th>Branches</Th>
                      <Th>Role</Th>
                    </Tr>
                  </thead>
                  <tbody>
                    {(people.data ?? []).map((person) => (
                      <Tr key={person.code}>
                        <Td className="font-mono tracking-[0.15em] text-ink">
                          <Link href={`/employees/${person.code}`} className="underline">
                            {person.code}
                          </Link>
                        </Td>
                        <Td>
                          {person.firstName} {person.lastName}
                        </Td>
                        <Td className="text-muted">
                          {person.branches.length === 0 ? (
                            // Not a gap: an owner or an all-branch manager
                            // acts from their role, not from a posting.
                            <span className="text-faint">Not posted to a branch</span>
                          ) : (
                            person.branches.map((b) => b.branchName).join(', ')
                          )}
                        </Td>
                        <Td>
                          {person.roles.map((r) => (
                            <Badge key={r.role} tone={r.allBranches ? 'available' : 'neutral'}>
                              {r.role.replace(/_/g, ' ').toLowerCase()}
                              {r.allBranches ? ' · all branches' : ''}
                            </Badge>
                          ))}
                        </Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            )
          ) : null}

          <p className="mt-4 text-[12px] text-muted">
            A code stays with the person for as long as they work here. Moving them between
            branches does not change it, and it is never given to anybody else.
          </p>
        </Surface>

        {isOwner && partnerId ? (
          <InvitationsCard partnerId={partnerId} branches={branches.data ?? []} />
        ) : null}

        <Surface>
          <h3 className="text-[15px] font-semibold text-ink">Look up a code</h3>
          <form
            className="mt-3 flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (trimmed) router.push(`/employees/${encodeURIComponent(trimmed)}`);
            }}
          >
            <Field label="Employee code">
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="EMP-001"
                autoComplete="off"
                className="font-mono tracking-[0.15em]"
              />
            </Field>
            <Button type="submit" disabled={!trimmed}>
              Look up
            </Button>
          </form>
          <p className="mt-3 text-[12px] text-muted">
            For a code read off a paper receipt, when the person is not in the list above.
          </p>
        </Surface>
      </div>
    </>
  );
}

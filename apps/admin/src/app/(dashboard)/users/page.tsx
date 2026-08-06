'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Role } from '@tutak/shared-types';
import { Badge, Button, EmptyState, PageHeader, Table, Td, Th, Tr } from '@tutak/design/web';
import { adminApi } from '@/lib/api/adminApi';

const num = (v: string | number | undefined) =>
  Number(v ?? 0).toLocaleString('en-US', { maximumFractionDigits: 2 }).replace(/,/g, ' ');

export default function UsersPage() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['admin-users'], queryFn: () => adminApi.listUsers() });
  const [busyId, setBusyId] = useState<string | null>(null);

  const run = async (id: string, fn: () => Promise<unknown>) => {
    setBusyId(id);
    try {
      await fn();
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
    } finally {
      setBusyId(null);
    }
  };

  const users = data?.items ?? [];

  return (
    <>
      <PageHeader title="Users" description="Every account on the platform." />

      {isLoading ? (
        <Table>
          <tbody>
            {[0, 1, 2, 3].map((i) => (
              <tr key={i}>
                <Td>
                  <div className="h-5 w-full animate-pulse rounded bg-canvas" />
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : users.length === 0 ? (
        <EmptyState title="No users yet" message="Accounts will appear here as people sign up." />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Phone</Th>
              <Th>Roles</Th>
              <Th align="right">Available bonus</Th>
              <Th>Status</Th>
              <Th align="right" />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <Tr key={u.id}>
                <Td>
                  <div className="font-medium text-ink">
                    {u.firstName} {u.lastName}
                  </div>
                  {u.email ? <div className="text-[12px] text-faint">{u.email}</div> : null}
                </Td>
                <Td className="tabular text-muted">{u.phone}</Td>
                <Td>
                  <div className="flex flex-wrap gap-1.5">
                    {u.roles.map((r) => (
                      <Badge key={r.role.name} tone="neutral" dot={false}>
                        {r.role.name.replace(/_/g, ' ').toLowerCase()}
                      </Badge>
                    ))}
                  </div>
                </Td>
                <Td align="right" className="tabular">
                  {u.wallet ? num(u.wallet.availableBonus) : '—'}
                </Td>
                <Td>
                  <Badge tone={u.isActive ? 'available' : 'danger'}>
                    {u.isActive ? 'Active' : 'Deactivated'}
                  </Badge>
                </Td>
                <Td align="right">
                  <div className="flex justify-end gap-2">
                    <Button
                      size="sm"
                      variant="tertiary"
                      disabled={busyId === u.id}
                      onClick={() => run(u.id, () => adminApi.assignRole(u.id, Role.ADMIN))}
                    >
                      Make admin
                    </Button>
                    <Button
                      size="sm"
                      variant={u.isActive ? 'destructive' : 'secondary'}
                      disabled={busyId === u.id}
                      onClick={() => run(u.id, () => adminApi.setUserActive(u.id, !u.isActive))}
                    >
                      {u.isActive ? 'Deactivate' : 'Reactivate'}
                    </Button>
                  </div>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}

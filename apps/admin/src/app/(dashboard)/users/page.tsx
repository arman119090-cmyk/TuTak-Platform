'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Role } from '@tutak/shared-types';
import { adminApi } from '@/lib/api/adminApi';

export default function UsersPage() {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ['admin-users'], queryFn: () => adminApi.listUsers() });
  const [busyId, setBusyId] = useState<string | null>(null);

  const handleToggleActive = async (id: string, isActive: boolean) => {
    setBusyId(id);
    try {
      await adminApi.setUserActive(id, !isActive);
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
    } finally {
      setBusyId(null);
    }
  };

  const handlePromote = async (id: string) => {
    setBusyId(id);
    try {
      await adminApi.assignRole(id, Role.ADMIN);
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-semibold">Users</h1>
      <div className="mt-6 overflow-hidden rounded-2xl border border-black/5 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-neutral-500">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Phone</th>
              <th className="px-4 py-3">Roles</th>
              <th className="px-4 py-3">Wallet</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {data?.items.map((u) => (
              <tr key={u.id} className="border-t border-neutral-100">
                <td className="px-4 py-3">
                  {u.firstName} {u.lastName}
                </td>
                <td className="px-4 py-3">{u.phone}</td>
                <td className="px-4 py-3">{u.roles.map((r) => r.role.name).join(', ')}</td>
                <td className="px-4 py-3">{u.wallet?.availableBonus ?? '—'}</td>
                <td className="px-4 py-3">
                  <span className={u.isActive ? 'text-bonus-available' : 'text-red-500'}>
                    {u.isActive ? 'Active' : 'Deactivated'}
                  </span>
                </td>
                <td className="space-x-2 px-4 py-3 text-right">
                  <button
                    disabled={busyId === u.id}
                    onClick={() => handlePromote(u.id)}
                    className="rounded-md border border-neutral-200 px-2 py-1 text-xs hover:bg-neutral-50"
                  >
                    Make admin
                  </button>
                  <button
                    disabled={busyId === u.id}
                    onClick={() => handleToggleActive(u.id, u.isActive)}
                    className="rounded-md border border-neutral-200 px-2 py-1 text-xs hover:bg-neutral-50"
                  >
                    {u.isActive ? 'Deactivate' : 'Reactivate'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

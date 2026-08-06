'use client';

import { useQuery } from '@tanstack/react-query';
import { auditApi } from '@/lib/api/auditApi';

export default function AuditLogsPage() {
  const { data } = useQuery({ queryKey: ['audit-logs'], queryFn: () => auditApi.list() });

  return (
    <div>
      <h1 className="text-2xl font-semibold">Audit log</h1>
      <p className="mt-1 text-sm text-neutral-500">Immutable record of every security- and money-relevant action.</p>

      <div className="mt-6 overflow-hidden rounded-2xl border border-black/5 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-neutral-500">
            <tr>
              <th className="px-4 py-3">Action</th>
              <th className="px-4 py-3">Entity</th>
              <th className="px-4 py-3">Actor</th>
              <th className="px-4 py-3">When</th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((log) => (
              <tr key={log.id} className="border-t border-neutral-100">
                <td className="px-4 py-3 font-medium">{log.action}</td>
                <td className="px-4 py-3">
                  {log.entityType}
                  {log.entityId ? ` #${log.entityId.slice(0, 8)}` : ''}
                </td>
                <td className="px-4 py-3">
                  {log.actor ? `${log.actor.firstName} ${log.actor.lastName}` : 'System'}
                </td>
                <td className="px-4 py-3">{new Date(log.createdAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

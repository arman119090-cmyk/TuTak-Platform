'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { securityApi } from '@/lib/api/auditApi';

export default function FraudSignalsPage() {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ['fraud-signals'], queryFn: securityApi.listOpenFraudSignals });

  const handleResolve = async (id: string) => {
    await securityApi.resolve(id);
    queryClient.invalidateQueries({ queryKey: ['fraud-signals'] });
  };

  return (
    <div>
      <h1 className="text-2xl font-semibold">Fraud signals</h1>
      <p className="mt-1 text-sm text-neutral-500">Open signals raised by the rule-based detector.</p>

      <div className="mt-6 overflow-hidden rounded-2xl border border-black/5 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-neutral-500">
            <tr>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Severity</th>
              <th className="px-4 py-3">User</th>
              <th className="px-4 py-3">Raised</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {data?.map((signal) => (
              <tr key={signal.id} className="border-t border-neutral-100">
                <td className="px-4 py-3">{signal.type}</td>
                <td className="px-4 py-3">
                  <span
                    className={
                      signal.severity === 'HIGH'
                        ? 'text-red-600'
                        : signal.severity === 'MEDIUM'
                          ? 'text-bonus-pending'
                          : 'text-neutral-500'
                    }
                  >
                    {signal.severity}
                  </span>
                </td>
                <td className="px-4 py-3">{signal.userId ?? '—'}</td>
                <td className="px-4 py-3">{new Date(signal.createdAt).toLocaleString()}</td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => handleResolve(signal.id)}
                    className="rounded-md border border-neutral-200 px-2 py-1 text-xs hover:bg-neutral-50"
                  >
                    Resolve
                  </button>
                </td>
              </tr>
            ))}
            {data?.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-neutral-400">
                  No open fraud signals.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

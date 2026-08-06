'use client';

import { useQuery } from '@tanstack/react-query';
import { getPrimaryPartnerId, useAuthStore } from '@/lib/stores/authStore';
import { partnerApi } from '@/lib/api/partnerApi';

export default function TransactionsPage() {
  const { user } = useAuthStore();
  const partnerId = getPrimaryPartnerId(user);

  const { data } = useQuery({
    queryKey: ['partner-transactions', partnerId],
    queryFn: () => partnerApi.transactions(partnerId!),
    enabled: !!partnerId,
  });

  return (
    <div>
      <h1 className="text-2xl font-semibold">Transactions</h1>

      <div className="mt-6 overflow-hidden rounded-2xl border border-black/5 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-neutral-500">
            <tr>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Amount</th>
              <th className="px-4 py-3">Bonus applied</th>
              <th className="px-4 py-3">Bonus earned</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Date</th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((tx) => (
              <tr key={tx.id} className="border-t border-neutral-100">
                <td className="px-4 py-3">{tx.type}</td>
                <td className="px-4 py-3">{tx.amount} AMD</td>
                <td className="px-4 py-3">{tx.bonusAppliedAmount}</td>
                <td className="px-4 py-3">{tx.bonusEarnedAmount}</td>
                <td className="px-4 py-3">{tx.status}</td>
                <td className="px-4 py-3">{new Date(tx.createdAt).toLocaleString()}</td>
              </tr>
            ))}
            {data?.items.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-neutral-400">
                  No transactions yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

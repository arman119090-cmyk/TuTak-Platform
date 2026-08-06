'use client';

import { useQuery } from '@tanstack/react-query';
import { getPrimaryPartnerId, useAuthStore } from '@/lib/stores/authStore';
import { evApi } from '@/lib/api/evApi';

export default function EvStationsPage() {
  const { user } = useAuthStore();
  const partnerId = getPrimaryPartnerId(user);
  const { data } = useQuery({ queryKey: ['ev-stations'], queryFn: evApi.listStations });

  const ownStations = data?.filter((s) => s.partnerId === partnerId) ?? [];

  return (
    <div>
      <h1 className="text-2xl font-semibold">EV stations</h1>
      <p className="mt-1 text-sm text-neutral-500">Charging stations registered under your business.</p>

      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        {ownStations.map((station) => (
          <div key={station.id} className="rounded-2xl border border-black/5 bg-white p-6 shadow-sm">
            <h2 className="font-semibold">{station.name}</h2>
            <p className="mt-1 text-sm text-neutral-500">{station.address}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {station.connectors.map((c) => (
                <span
                  key={c.id}
                  className={`rounded-full px-2 py-1 text-xs ${
                    c.status === 'AVAILABLE'
                      ? 'bg-bonus-available/10 text-bonus-available'
                      : c.status === 'CHARGING'
                        ? 'bg-bonus-reserved/10 text-bonus-reserved'
                        : 'bg-neutral-100 text-neutral-500'
                  }`}
                >
                  {c.connectorType} — {c.status}
                </span>
              ))}
            </div>
          </div>
        ))}
        {ownStations.length === 0 ? (
          <p className="text-sm text-neutral-400">No stations registered yet. Contact TuTak support to add one.</p>
        ) : null}
      </div>
    </div>
  );
}

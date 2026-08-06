'use client';

import { useQuery } from '@tanstack/react-query';
import { Badge, EmptyState, PageHeader, StatTile, Surface } from '@tutak/design/web';
import type { BadgeTone } from '@tutak/design/web';
import { getPrimaryPartnerId, useAuthStore } from '@/lib/stores/authStore';
import { evApi } from '@/lib/api/evApi';

const num = (v: string | number | undefined) =>
  Number(v ?? 0).toLocaleString('en-US', { maximumFractionDigits: 2 }).replace(/,/g, ' ');

function connectorTone(status: string): BadgeTone {
  if (status === 'AVAILABLE') return 'available';
  if (status === 'CHARGING' || status === 'RESERVED') return 'reserved';
  if (status === 'OUTOFORDER' || status === 'INOPERATIVE') return 'danger';
  return 'neutral';
}

export default function EvStationsPage() {
  const { user } = useAuthStore();
  const partnerId = getPrimaryPartnerId(user);
  const { data } = useQuery({ queryKey: ['ev-stations'], queryFn: evApi.listStations });

  const stations = (data ?? []).filter((s) => s.partnerId === partnerId);
  const connectors = stations.flatMap((s) => s.connectors);
  const free = connectors.filter((c) => c.status === 'AVAILABLE').length;
  const busy = connectors.filter((c) => c.status === 'CHARGING').length;

  return (
    <>
      <PageHeader
        title="EV stations"
        description="Charging points registered under your business."
      />

      {stations.length === 0 ? (
        <EmptyState
          title="No stations registered"
          message="Contact your TuTak account manager to add charging stations to your business."
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatTile label="Stations" value={stations.length} />
            <StatTile label="Connectors free" value={free} tone="available" />
            <StatTile label="Currently charging" value={busy} tone="reserved" />
          </div>

          <div className="mt-4 space-y-4">
            {stations.map((station) => (
              <Surface key={station.id}>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="text-[17px] font-semibold text-ink">{station.name}</div>
                    <div className="mt-1 text-[13px] text-muted">
                      {station.address}, {station.city}
                    </div>
                  </div>
                  <Badge tone={station.connectors.some((c) => c.status === 'AVAILABLE') ? 'available' : 'pending'}>
                    {station.connectors.filter((c) => c.status === 'AVAILABLE').length} of{' '}
                    {station.connectors.length} free
                  </Badge>
                </div>

                <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {station.connectors.map((c) => (
                    <div
                      key={c.id}
                      className="flex items-center justify-between rounded-tutak-md border border-line px-3.5 py-3"
                    >
                      <div>
                        <div className="text-[14px] font-medium text-ink">
                          {c.connectorType.replace(/_/g, ' ')}
                        </div>
                        <div className="tabular mt-0.5 text-[12px] text-faint">
                          {num(c.powerKw)} kW · {num(c.pricePerKwh)} ֏/kWh
                        </div>
                      </div>
                      <Badge tone={connectorTone(c.status)}>{c.status.toLowerCase()}</Badge>
                    </div>
                  ))}
                </div>
              </Surface>
            ))}
          </div>
        </>
      )}
    </>
  );
}

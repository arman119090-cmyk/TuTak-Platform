'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Select,
  Surface,
  Table,
  Td,
  Th,
  Tr,
} from '@tutak/design/web';
import { partnersApi } from '@/lib/api/partnersApi';
import { fastChargeApi } from '@/lib/api/fastChargeApi';

/**
 * Admin visibility into FastCharge station-level tariffs, and the ability to
 * adjust them — docs/FASTCHARGE_INTEGRATION_2026-08-25.md's admin-panel
 * requirement. Editing here only ever writes `EvStation.standardRetailRatePerKwh`
 * (the *display* tariff); it can never reach an already-settled session's own
 * frozen figures — see `FastChargeStationsService.updateTariff`'s docblock.
 */
export default function FastChargeStationsPage() {
  const queryClient = useQueryClient();
  const { data: partners } = useQuery({ queryKey: ['partners'], queryFn: partnersApi.list });
  const [partnerId, setPartnerId] = useState<string>('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftRate, setDraftRate] = useState('');
  const [saving, setSaving] = useState(false);

  const { data: stations } = useQuery({
    queryKey: ['fastcharge-stations', partnerId],
    queryFn: () => fastChargeApi.listStations(partnerId),
    enabled: !!partnerId,
  });

  const startEdit = (stationId: string, currentRate: string | null) => {
    setEditingId(stationId);
    setDraftRate(currentRate ?? '');
  };

  const save = async (stationId: string) => {
    setSaving(true);
    try {
      await fastChargeApi.updateStationTariff(stationId, draftRate);
      await queryClient.invalidateQueries({ queryKey: ['fastcharge-stations', partnerId] });
      setEditingId(null);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader
        title="FastCharge stations"
        description="Per-station standard tariffs for the FastCharge wholesale-resale integration. A change here only affects future sessions — every completed session keeps its own frozen figures."
      />

      <Surface className="mb-5">
        <Field label="Partner">
          <Select value={partnerId} onChange={(e) => setPartnerId(e.target.value)}>
            <option value="">Select a FastCharge partner…</option>
            {(partners ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.displayName}
              </option>
            ))}
          </Select>
        </Field>
      </Surface>

      {!partnerId ? null : (stations ?? []).length === 0 ? (
        <EmptyState
          title="No FastCharge stations for this partner"
          message="Stations appear here once FastCharge syncs them via POST /fastcharge/stations/sync."
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Station</Th>
              <Th>External ID</Th>
              <Th align="right">Standard retail rate</Th>
              <Th>Connectors</Th>
              <Th align="right" />
            </tr>
          </thead>
          <tbody>
            {(stations ?? []).map((s) => (
              <Tr key={s.id}>
                <Td>
                  <div className="font-medium text-ink">{s.name}</div>
                  <div className="text-[12px] text-faint">
                    {s.address}, {s.city}
                  </div>
                </Td>
                <Td className="text-muted">{s.externalStationId}</Td>
                <Td align="right" className="tabular">
                  {editingId === s.id ? (
                    <Input
                      inputMode="decimal"
                      value={draftRate}
                      onChange={(e) => setDraftRate(e.target.value)}
                      style={{ width: 110, textAlign: 'right' }}
                    />
                  ) : (
                    `${s.standardRetailRatePerKwh ?? '—'} ֏/kWh`
                  )}
                </Td>
                <Td>
                  <Badge tone="neutral">{s.connectors.length}</Badge>
                </Td>
                <Td align="right">
                  {editingId === s.id ? (
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="tertiary" onClick={() => setEditingId(null)}>
                        Cancel
                      </Button>
                      <Button size="sm" loading={saving} onClick={() => save(s.id)}>
                        Save
                      </Button>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => startEdit(s.id, s.standardRetailRatePerKwh)}
                    >
                      Edit tariff
                    </Button>
                  )}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}

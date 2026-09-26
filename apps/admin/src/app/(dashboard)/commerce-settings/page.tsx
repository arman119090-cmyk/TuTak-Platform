'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { SettlementPeriod } from '@tutak/shared-types';
import { Badge, Button, Input, PageHeader, Select, Surface, Table, Td, Th, Tr } from '@tutak/design/web';
import { apiErrorMessage, partnerOrderAdminApi } from '@/lib/api/partnerOrderAdminApi';

/**
 * Commerce configuration for one partner — never code, never a partner name
 * in an `if` (spec §12, §30, §51, §67; Q4, Q5, Q7b):
 *  - commission overrides by service type / category on top of the partner's
 *    own base rate (same 0.5–20% card);
 *  - prepayment (0 / percent / fixed) by partner, service type or category;
 *  - the partner's settlement period;
 *  - bringing the mandatory-shift date forward (it can never be pushed back).
 */
export default function CommerceSettingsPage() {
  const queryClient = useQueryClient();
  const [partnerId, setPartnerId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [rule, setRule] = useState({ serviceType: '', category: '', name: '', rateBps: '500' });
  const [prepay, setPrepay] = useState({ serviceType: '', category: '', mode: 'PERCENT' as 'PERCENT' | 'FIXED', value: '' });
  const [period, setPeriod] = useState<SettlementPeriod>('BIWEEKLY' as SettlementPeriod);
  const [shiftsFrom, setShiftsFrom] = useState('');

  const enabled = /^[0-9a-f-]{36}$/i.test(partnerId);
  const { data: rules } = useQuery({
    queryKey: ['commission-rules', partnerId],
    queryFn: () => partnerOrderAdminApi.listCommissionRules(partnerId),
    enabled,
  });
  const { data: prepayments } = useQuery({
    queryKey: ['prepayment-rules', partnerId],
    queryFn: () => partnerOrderAdminApi.listPrepaymentRules(partnerId),
    enabled,
  });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['commission-rules', partnerId] });
    void queryClient.invalidateQueries({ queryKey: ['prepayment-rules', partnerId] });
  };
  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      setError(null);
      refresh();
    } catch (err) {
      setError(apiErrorMessage(err, 'Action failed'));
    }
  };

  return (
    <>
      <PageHeader title="Commerce settings" description="Per-partner commission overrides, prepayment, settlement period and shift rollout." />
      <Surface className="mb-6">
        <label className="text-[13px] text-muted">Partner id</label>
        <Input value={partnerId} onChange={(e) => setPartnerId(e.target.value.trim())} placeholder="Partner UUID (from the Partners page)" />
      </Surface>
      {error ? <div className="mb-3 text-[13px] text-danger-text">{error}</div> : null}
      {enabled ? (
        <div className="grid gap-6">
          <Surface>
            <div className="mb-2 font-semibold">Commission overrides</div>
            <p className="mb-3 text-[13px] text-muted">
              Without a matching override the partner&apos;s own base rate applies. One active rule per scope; one rate per order.
            </p>
            <Table>
              <thead>
                <tr>
                  <Th>Name</Th>
                  <Th>Service type</Th>
                  <Th>Category</Th>
                  <Th align="right">Rate</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {(rules ?? []).map((r) => (
                  <Tr key={r.id}>
                    <Td>{r.name}</Td>
                    <Td>{r.serviceType ?? '—'}</Td>
                    <Td>{r.category ?? '—'}</Td>
                    <Td align="right">{r.rateBps / 100}%</Td>
                    <Td align="right">
                      {r.isActive ? (
                        <Button size="sm" variant="secondary" onClick={() => act(() => partnerOrderAdminApi.deactivateCommissionRule(r.id))}>
                          Deactivate
                        </Button>
                      ) : (
                        <Badge>inactive</Badge>
                      )}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
            <div className="mt-3 flex flex-wrap gap-2">
              <Input placeholder="Name" value={rule.name} onChange={(e) => setRule({ ...rule, name: e.target.value })} className="w-48" />
              <Input placeholder="Service type" value={rule.serviceType} onChange={(e) => setRule({ ...rule, serviceType: e.target.value })} className="w-48" />
              <Input placeholder="Category" value={rule.category} onChange={(e) => setRule({ ...rule, category: e.target.value })} className="w-40" />
              <Input placeholder="Rate bps (500 = 5%)" value={rule.rateBps} onChange={(e) => setRule({ ...rule, rateBps: e.target.value })} className="w-40" />
              <Button
                disabled={!rule.name || (!rule.serviceType && !rule.category)}
                onClick={() =>
                  act(() =>
                    partnerOrderAdminApi.createCommissionRule({
                      partnerId,
                      name: rule.name,
                      serviceType: rule.serviceType || undefined,
                      category: rule.category || undefined,
                      rateBps: Number(rule.rateBps),
                    }),
                  )
                }
              >
                Add override
              </Button>
            </div>
          </Surface>

          <Surface>
            <div className="mb-2 font-semibold">Prepayment</div>
            <p className="mb-3 text-[13px] text-muted">No rule = no prepayment. The customer sees it before confirming the order.</p>
            <Table>
              <thead>
                <tr>
                  <Th>Service type</Th>
                  <Th>Category</Th>
                  <Th>Rule</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {(prepayments ?? []).map((p) => (
                  <Tr key={p.id}>
                    <Td>{p.serviceType ?? 'any'}</Td>
                    <Td>{p.category ?? 'any'}</Td>
                    <Td>{p.mode === 'PERCENT' ? `${(p.percentBps ?? 0) / 100}%` : `${Number(p.fixedAmount).toLocaleString('en-US')} ֏`}</Td>
                    <Td align="right">
                      {p.isActive ? (
                        <Button size="sm" variant="secondary" onClick={() => act(() => partnerOrderAdminApi.deactivatePrepaymentRule(p.id))}>
                          Deactivate
                        </Button>
                      ) : (
                        <Badge>inactive</Badge>
                      )}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
            <div className="mt-3 flex flex-wrap gap-2">
              <Input placeholder="Service type (optional)" value={prepay.serviceType} onChange={(e) => setPrepay({ ...prepay, serviceType: e.target.value })} className="w-48" />
              <Input placeholder="Category (optional)" value={prepay.category} onChange={(e) => setPrepay({ ...prepay, category: e.target.value })} className="w-40" />
              <Select value={prepay.mode} onChange={(e) => setPrepay({ ...prepay, mode: e.target.value as 'PERCENT' | 'FIXED' })} className="w-auto">
                <option value="PERCENT">Percent (bps)</option>
                <option value="FIXED">Fixed AMD</option>
              </Select>
              <Input placeholder={prepay.mode === 'PERCENT' ? '3000 = 30%' : 'Amount'} value={prepay.value} onChange={(e) => setPrepay({ ...prepay, value: e.target.value })} className="w-40" />
              <Button
                disabled={!prepay.value}
                onClick={() =>
                  act(() =>
                    partnerOrderAdminApi.createPrepaymentRule({
                      partnerId,
                      serviceType: prepay.serviceType || undefined,
                      category: prepay.category || undefined,
                      mode: prepay.mode,
                      ...(prepay.mode === 'PERCENT' ? { percentBps: Number(prepay.value) } : { fixedAmount: prepay.value }),
                    }),
                  )
                }
              >
                Add prepayment rule
              </Button>
            </div>
          </Surface>

          <Surface>
            <div className="mb-2 font-semibold">Settlement period and shifts</div>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={period} onChange={(e) => setPeriod(e.target.value as SettlementPeriod)} className="w-auto">
                <option value="DAILY">Daily</option>
                <option value="WEEKLY">Weekly</option>
                <option value="BIWEEKLY">Every two weeks</option>
                <option value="MONTHLY">Monthly</option>
              </Select>
              <Button variant="secondary" onClick={() => act(() => partnerOrderAdminApi.setSettlementPeriod(partnerId, period))}>
                Save settlement period
              </Button>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Input type="datetime-local" value={shiftsFrom} onChange={(e) => setShiftsFrom(e.target.value)} className="w-64" />
              <Button
                variant="secondary"
                disabled={!shiftsFrom}
                onClick={() => act(() => partnerOrderAdminApi.requireShiftsFrom(partnerId, new Date(shiftsFrom).toISOString()))}
              >
                Make shifts mandatory from this date (earlier only)
              </Button>
            </div>
          </Surface>
        </div>
      ) : null}
    </>
  );
}

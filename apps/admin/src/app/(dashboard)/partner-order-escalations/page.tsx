'use client';

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, EmptyState, PageHeader, Table, Td, Th, Tr } from '@tutak/design/web';
import { partnerOrderAdminApi } from '@/lib/api/partnerOrderAdminApi';

const TYPE_LABEL: Record<string, string> = {
  NOT_SEEN_5MIN: 'Not seen (5 min)',
  STOCK_NOT_CONFIRMED_30MIN: 'Stock not confirmed (30 min)',
  STOCK_NOT_CONFIRMED_REPEAT: 'Stock still not confirmed',
};

function elapsed(from: string, now: number) {
  const minutes = Math.floor((now - +new Date(from)) / 60_000);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/**
 * Spec §8-9/§21: TuTak's own "needs attention" queue for Partner Commerce
 * orders. Mirrors the fraud-signals page exactly, plus a claim step spec §9
 * explicitly asks for ("взял в работу") — claiming stops further alerts for
 * this specific problem without hiding it from anyone else still watching.
 */
export default function PartnerOrderEscalationsPage() {
  const queryClient = useQueryClient();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const { data } = useQuery({
    queryKey: ['partner-order-escalations'],
    queryFn: partnerOrderAdminApi.listEscalations,
    refetchInterval: 15000,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['partner-order-escalations'] });
  const escalations = data ?? [];

  return (
    <>
      <PageHeader
        title="Order escalations"
        description="Orders a partner has not acknowledged or confirmed in time. Claim one to take it into work — it stays here for everyone else until resolved."
      />

      {escalations.length === 0 ? (
        <EmptyState title="Nothing needs attention" message="Escalations appear here automatically when an order runs past its SLA." />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Order</Th>
              <Th>Problem</Th>
              <Th>Elapsed</Th>
              <Th>Claimed by</Th>
              <Th align="right" />
            </tr>
          </thead>
          <tbody>
            {escalations.map((e) => (
              <Tr key={e.id}>
                <Td className="font-mono text-[12px] text-faint">
                  {e.order ? `#${e.order.orderNumber}` : e.orderId.slice(-8)}
                </Td>
                <Td>
                  <Badge tone="danger">{TYPE_LABEL[e.type] ?? e.type}</Badge>
                </Td>
                <Td className="text-muted">{elapsed(e.order?.createdAt ?? e.createdAt, now)}</Td>
                <Td className="text-muted">{e.claimedByUserId ? 'Claimed' : '—'}</Td>
                <Td align="right">
                  <div className="flex items-center justify-end gap-2">
                    {!e.claimedByUserId && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={async () => {
                          await partnerOrderAdminApi.claimEscalation(e.id);
                          invalidate();
                        }}
                      >
                        Take into work
                      </Button>
                    )}
                    <Button
                      size="sm"
                      onClick={async () => {
                        await partnerOrderAdminApi.resolveEscalation(e.id);
                        invalidate();
                      }}
                    >
                      Resolve
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

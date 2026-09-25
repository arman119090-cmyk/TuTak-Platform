'use client';

import { Fragment, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, EmptyState, Input, PageHeader, Table, Td, Th, Tr } from '@tutak/design/web';
import { partnerOrderAdminApi } from '@/lib/api/partnerOrderAdminApi';

const num = (v: string | number | undefined) =>
  Number(v ?? 0).toLocaleString('en-US', { maximumFractionDigits: 2 }).replace(/,/g, ' ');

/**
 * Spec §13: TuTak staff's internal "find this item elsewhere" queue for an
 * order whose partner said "Нет в наличии". Three buttons per row, exactly
 * as spec describes: НАШЁЛ ТОЧНЫЙ ТОВАР / НАШЁЛ АНАЛОГ / НЕ НАЙДЕН.
 */
export default function PartnerOrderSourcingPage() {
  const queryClient = useQueryClient();
  const [formId, setFormId] = useState<string | null>(null);
  const [mode, setMode] = useState<'FOUND_EXACT' | 'FOUND_ALTERNATE' | null>(null);
  const [productName, setProductName] = useState('');
  const [price, setPrice] = useState('');

  const { data } = useQuery({
    queryKey: ['partner-order-sourcing'],
    queryFn: partnerOrderAdminApi.listSourcingTasks,
    refetchInterval: 15000,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['partner-order-sourcing'] });
  const closeForm = () => {
    setFormId(null);
    setMode(null);
    setProductName('');
    setPrice('');
  };
  const tasks = data ?? [];

  return (
    <>
      <PageHeader
        title="Sourcing queue"
        description="Orders whose partner does not have the item — TuTak looks for it among other partners, then externally, before refunding."
      />

      {tasks.length === 0 ? (
        <EmptyState title="Nothing to source" message="A task appears here whenever a partner marks an order out of stock (with sourcing enabled)." />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Order</Th>
              <Th>Item requested</Th>
              <Th align="right">Paid</Th>
              <Th>Status</Th>
              <Th align="right" />
            </tr>
          </thead>
          <tbody>
            {tasks.map((task) => (
              <Fragment key={task.id}>
                <Tr>
                  <Td className="font-mono text-[12px] text-faint">
                    {task.order ? `#${task.order.orderNumber}` : task.orderId.slice(-8)}
                  </Td>
                  <Td>{task.order?.items.map((i) => `${i.quantity}× ${i.name}`).join(', ') ?? '—'}</Td>
                  <Td align="right" className="tabular">
                    {task.order ? `${num(task.order.totalAmount)} ֏` : '—'}
                  </Td>
                  <Td>
                    <Badge tone={task.status === 'SEARCHING' ? 'pending' : 'neutral'}>{task.status}</Badge>
                  </Td>
                  <Td align="right">
                    <div className="flex items-center justify-end gap-2">
                      {task.status === 'OPEN' && (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={async () => {
                            await partnerOrderAdminApi.claimSourcingTask(task.id);
                            invalidate();
                          }}
                        >
                          Take into work
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setFormId(task.id);
                          setMode('FOUND_EXACT');
                        }}
                      >
                        НАШЁЛ ТОЧНЫЙ ТОВАР
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setFormId(task.id);
                          setMode('FOUND_ALTERNATE');
                        }}
                      >
                        НАШЁЛ АНАЛОГ
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={async () => {
                          await partnerOrderAdminApi.recordSourcingResult(task.id, { status: 'NOT_FOUND' });
                          invalidate();
                        }}
                      >
                        НЕ НАЙДЕН
                      </Button>
                    </div>
                  </Td>
                </Tr>
                {formId === task.id && mode && (
                  <Tr>
                    <Td colSpan={5}>
                      <div className="flex items-center gap-2 py-2">
                        <Input
                          autoFocus
                          placeholder={mode === 'FOUND_EXACT' ? 'Product name (same item)' : 'Alternate product name'}
                          value={productName}
                          onChange={(e) => setProductName(e.target.value)}
                          className="h-8 w-64 text-[13px]"
                        />
                        <Input
                          placeholder="Price"
                          value={price}
                          onChange={(e) => setPrice(e.target.value)}
                          className="h-8 w-32 text-[13px]"
                        />
                        <Button
                          size="sm"
                          disabled={!productName || !price}
                          onClick={async () => {
                            await partnerOrderAdminApi.recordSourcingResult(task.id, {
                              status: mode,
                              productName,
                              price,
                            });
                            closeForm();
                            invalidate();
                          }}
                        >
                          Save
                        </Button>
                        <Button size="sm" variant="secondary" onClick={closeForm}>
                          Cancel
                        </Button>
                      </div>
                    </Td>
                  </Tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}

'use client';

import { useQuery } from '@tanstack/react-query';
import { Badge, EmptyState, PageHeader, Table, Td, Th, Tr } from '@tutak/design/web';
import { auditApi } from '@/lib/api/auditApi';

/** Actions that move money or change access get a coloured marker. */
function toneFor(action: string): 'available' | 'pending' | 'danger' | 'neutral' {
  if (action.startsWith('BONUS_')) return 'available';
  if (action.includes('FRAUD') || action.includes('LOCKED') || action.includes('FAILED')) {
    return 'danger';
  }
  if (action.includes('ROLE') || action.includes('PARTNER')) return 'pending';
  return 'neutral';
}

export default function AuditLogsPage() {
  const { data } = useQuery({ queryKey: ['audit-logs'], queryFn: () => auditApi.list() });
  const items = data?.items ?? [];

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Immutable record of every security- and money-relevant action."
      />

      {items.length === 0 ? (
        <EmptyState title="No entries yet" message="Actions are recorded here as they happen." />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Action</Th>
              <Th>Entity</Th>
              <Th>Actor</Th>
              <Th align="right">When</Th>
            </tr>
          </thead>
          <tbody>
            {items.map((log) => (
              <Tr key={log.id}>
                <Td>
                  <Badge tone={toneFor(log.action)}>
                    {log.action.replace(/_/g, ' ').toLowerCase()}
                  </Badge>
                </Td>
                <Td>
                  <span className="text-ink">{log.entityType}</span>
                  {log.entityId ? (
                    <span className="tabular ml-2 text-[12px] text-faint">
                      {log.entityId.slice(0, 8)}
                    </span>
                  ) : null}
                </Td>
                <Td className="text-muted">
                  {log.actor ? (
                    <>
                      {log.actor.firstName} {log.actor.lastName}
                    </>
                  ) : (
                    <span className="text-faint">System</span>
                  )}
                </Td>
                <Td align="right" className="tabular text-[13px] text-muted">
                  {new Date(log.createdAt).toLocaleString()}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}

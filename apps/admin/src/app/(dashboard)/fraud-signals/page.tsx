'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, EmptyState, PageHeader, Table, Td, Th, Tr } from '@tutak/design/web';
import { securityApi } from '@/lib/api/auditApi';

const SEVERITY_TONE = {
  HIGH: 'danger',
  MEDIUM: 'pending',
  LOW: 'neutral',
} as const;

export default function FraudSignalsPage() {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ['fraud-signals'],
    queryFn: securityApi.listOpenFraudSignals,
  });

  const signals = data ?? [];

  return (
    <>
      <PageHeader
        title="Fraud signals"
        description="Open signals raised by the rule-based detector, newest first."
      />

      {signals.length === 0 ? (
        <EmptyState
          title="Nothing to review"
          message="No open fraud signals. New ones appear here automatically."
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Signal</Th>
              <Th>Severity</Th>
              <Th>User</Th>
              <Th>Raised</Th>
              <Th align="right" />
            </tr>
          </thead>
          <tbody>
            {signals.map((s) => (
              <Tr key={s.id}>
                <Td>
                  <span className="font-medium text-ink">
                    {s.type.replace(/_/g, ' ').toLowerCase()}
                  </span>
                </Td>
                <Td>
                  <Badge
                    tone={SEVERITY_TONE[s.severity as keyof typeof SEVERITY_TONE] ?? 'neutral'}
                  >
                    {s.severity.toLowerCase()}
                  </Badge>
                </Td>
                <Td className="tabular text-[12px] text-muted">{s.userId ?? '—'}</Td>
                <Td className="text-muted">{new Date(s.createdAt).toLocaleString()}</Td>
                <Td align="right">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={async () => {
                      await securityApi.resolve(s.id);
                      queryClient.invalidateQueries({ queryKey: ['fraud-signals'] });
                    }}
                  >
                    Resolve
                  </Button>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}

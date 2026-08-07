'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Surface,
  Table,
  Td,
  Th,
  Tr,
} from '@tutak/design/web';
import { financeApi, type ReconciliationFinding } from '@/lib/api/financeApi';

/** Yesterday, in UTC — the day a nightly run would normally cover. */
function defaultDay(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export default function ReconciliationPage() {
  const queryClient = useQueryClient();
  const [day, setDay] = useState(defaultDay);
  const [error, setError] = useState<string | null>(null);

  const { data: runs } = useQuery({
    queryKey: ['reconciliation-runs'],
    queryFn: financeApi.reconciliationRuns,
  });

  const run = useMutation({
    mutationFn: () => financeApi.runReconciliation(new Date(`${day}T00:00:00Z`).toISOString()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['reconciliation-runs'] }),
    onError: (e: Error) => setError(e.message),
  });

  const clearBlock = useMutation({
    mutationFn: (partnerId: string) => financeApi.clearPayoutBlock(partnerId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['reconciliation-runs'] }),
  });

  const history = runs ?? [];

  return (
    <>
      <PageHeader
        title="Reconciliation"
        description="Nightly comparison of the ledger against itself and against external statements. Drift is recorded and escalated — never corrected automatically."
      />

      <Surface>
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-48">
            <Field label="Day to reconcile">
              <Input type="date" value={day} onChange={(e) => setDay(e.target.value)} />
            </Field>
          </div>
          <Button
            onClick={() => {
              setError(null);
              run.mutate();
            }}
            disabled={run.isPending}
          >
            {run.isPending ? 'Running…' : 'Run now'}
          </Button>
        </div>
        <p className="mt-3 text-[13px] text-muted">
          Running without a statement checks internal consistency only — every account replayed
          against its own postings. That is the check worth running unattended: it catches the
          ledger disagreeing with itself.
        </p>
        {error && <p className="mt-2 text-[13px] text-danger">{error}</p>}
      </Surface>

      <div className="mt-6">
        {history.length === 0 ? (
          <EmptyState
            title="No runs yet"
            message="The nightly job runs at 03:00 UTC, or trigger one above."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Day</Th>
                <Th>Result</Th>
                <Th>Findings</Th>
                <Th>Run at</Th>
              </tr>
            </thead>
            <tbody>
              {history.map((r) => (
                <Tr key={r.id}>
                  <Td className="font-medium text-ink">{r.periodStart.slice(0, 10)}</Td>
                  <Td>
                    <Badge tone={r.status === 'CLEAN' ? 'available' : 'danger'}>
                      {r.status === 'CLEAN' ? 'clean' : 'drift detected'}
                    </Badge>
                  </Td>
                  <Td>
                    <FindingList
                      findings={(r.findings ?? []) as ReconciliationFinding[]}
                      onClearBlock={(partnerId) => clearBlock.mutate(partnerId)}
                      clearing={clearBlock.isPending}
                    />
                  </Td>
                  <Td className="text-muted">{new Date(r.createdAt).toLocaleString()}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>
    </>
  );
}

function FindingList({
  findings,
  onClearBlock,
  clearing,
}: {
  findings: ReconciliationFinding[];
  onClearBlock: (partnerId: string) => void;
  clearing: boolean;
}) {
  if (findings.length === 0) return <span className="text-muted">—</span>;

  return (
    <ul className="space-y-1.5">
      {findings.map((f, i) => (
        <li key={i} className="text-[13px]">
          <span className="font-medium text-ink">{f.account}</span>{' '}
          <span className="tabular text-muted">
            expected {f.expected}, reported {f.reported}, drift {f.drift}
          </span>
          {f.partnerId && (
            <Button
              size="sm"
              variant="secondary"
              className="ml-2"
              disabled={clearing}
              onClick={() => onClearBlock(f.partnerId!)}
            >
              Clear payout block
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

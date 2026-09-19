'use client';

import { useState } from 'react';
import { Button, PageHeader } from '@tutak/design/web';
import { accountingApi } from '@/lib/api/financeApi';

/**
 * The files the bookkeeper actually downloads.
 *
 * The endpoints existed for a day before this page did, which meant the
 * person they were built for could not reach them without `curl` and a
 * bearer token. An export with no way to ask for it is not an export.
 *
 * Both files cover a half-open period `[from, until)`. That is stated on the
 * page rather than left to be discovered: an accountant who assumes the end
 * date is included will double-count a day every month, and the arithmetic
 * will look right on both sides.
 */
export default function AccountingPage() {
  const [from, setFrom] = useState('');
  const [until, setUntil] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const download = async (what: 'ledger' | 'settlements') => {
    setBusy(what);
    setError(null);
    try {
      const blob =
        what === 'ledger'
          ? await accountingApi.ledgerCsv(from, until)
          : await accountingApi.settlementsCsv(from, until);

      // Object URL, revoked immediately after the click: leaving them alive
      // holds the whole file in memory for the life of the tab, and these
      // files are deliberately large.
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `tutak-${what}-${from}-${until}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      setError('That export could not be produced. Check the dates and try again.');
    } finally {
      setBusy(null);
    }
  };

  const ready = from !== '' && until !== '' && from < until;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Accounting exports"
        description="The ledger and the settlements that were paid, as CSV."
      />

      <div className="space-y-4 rounded-lg border border-subtle p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-[12px]">
            From (included)
            <input
              aria-label="From"
              type="date"
              className="rounded-md border border-subtle p-2 text-[13px]"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-[12px]">
            Until (not included)
            <input
              aria-label="Until"
              type="date"
              className="rounded-md border border-subtle p-2 text-[13px]"
              value={until}
              onChange={(e) => setUntil(e.target.value)}
            />
          </label>
        </div>

        <p className="text-[12px] text-faint">
          The end date is <strong>not</strong> included, so 1 September to 1 October is
          the whole of September and two neighbouring exports never share a day.
        </p>

        <div className="flex flex-wrap gap-2">
          <Button disabled={!ready || busy !== null} onClick={() => download('ledger')}>
            {busy === 'ledger' ? 'Preparing…' : 'Ledger postings'}
          </Button>
          <Button
            variant="secondary"
            disabled={!ready || busy !== null}
            onClick={() => download('settlements')}
          >
            {busy === 'settlements' ? 'Preparing…' : 'Settlements paid'}
          </Button>
        </div>

        {from !== '' && until !== '' && from >= until ? (
          <p className="text-[12px] text-danger">The end date must be after the start date.</p>
        ) : null}
        {error ? <p className="text-[12px] text-danger">{error}</p> : null}
      </div>
    </div>
  );
}

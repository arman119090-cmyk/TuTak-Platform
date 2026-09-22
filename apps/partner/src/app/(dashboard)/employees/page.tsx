'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Field, Input, PageHeader, Surface } from '@tutak/design/web';

/**
 * The lookup box for a code somebody is reading off paper.
 *
 * Navigating rather than fetching in place: the card has its own address, so
 * a partner can keep the link, send it to their accountant, or reach it from
 * a statement row without going through this box at all.
 */
export default function EmployeeLookupPage() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const trimmed = code.trim().toUpperCase();

  return (
    <>
      <PageHeader
        title="Employees"
        description="Turn an employee code from a receipt or a statement line into a person."
      />
      <Surface>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (trimmed) router.push(`/employees/${encodeURIComponent(trimmed)}`);
          }}
        >
          <Field label="Employee code">
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="EMP-001"
              autoComplete="off"
              className="font-mono tracking-[0.15em]"
            />
          </Field>
          <Button type="submit" disabled={!trimmed}>
            Look up
          </Button>
        </form>
        <p className="mt-3 text-[12px] text-muted">
          The code belongs to the person, not to a branch: it stays the same when somebody is
          moved, and it is never reused for anybody else.
        </p>
      </Surface>
    </>
  );
}

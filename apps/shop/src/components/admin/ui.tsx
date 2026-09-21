import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Small presentational helpers shared by the admin screens. */

export const AdminHeading = ({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) => (
  <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
    <div>
      <h1 className="font-sans text-[24px] font-semibold tracking-tight">{title}</h1>
      {subtitle ? <p className="mt-1 text-[13px] text-muted">{subtitle}</p> : null}
    </div>
    {action}
  </div>
);

export const StatCard = ({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'default' | 'success' | 'warning';
}) => (
  <div
    className={cn(
      'rounded-[var(--radius-md)] border bg-surface p-4',
      tone === 'success' ? 'border-[#C9E0D6]' : tone === 'warning' ? 'border-[#EBDCBB]' : 'border-line',
    )}
  >
    <p className="text-[12px] uppercase tracking-[0.08em] text-muted">{label}</p>
    <p className="mt-2 text-[26px] font-semibold tabular-nums">{value}</p>
    {hint ? <p className="mt-1 text-[12px] text-muted">{hint}</p> : null}
  </div>
);

export const Panel = ({
  title,
  action,
  children,
  className,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) => (
  <section className={cn('rounded-[var(--radius-md)] border border-line bg-surface', className)}>
    {title ? (
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <h2 className="text-[15px] font-sans font-semibold">{title}</h2>
        {action}
      </div>
    ) : null}
    {children}
  </section>
);

export const Table = ({ head, children }: { head: string[]; children: ReactNode }) => (
  <div className="hide-scrollbar overflow-x-auto">
    {/* Narrow enough to fit a side panel at 1280px, still scrollable below that. */}
    <table className="w-full min-w-[420px] border-collapse text-[13px]">
      <thead>
        <tr className="border-b border-line text-left text-[12px] uppercase tracking-[0.06em] text-muted">
          {head.map((cell) => (
            <th key={cell} className="px-4 py-2.5 font-medium">
              {cell}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-line">{children}</tbody>
    </table>
  </div>
);

export const AdminLink = ({ href, children }: { href: string; children: ReactNode }) => (
  <Link href={href} className="text-accent hover:underline">
    {children}
  </Link>
);

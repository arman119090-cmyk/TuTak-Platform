import * as React from 'react';

/** Tiny classname joiner — avoids pulling a dependency into the design package. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

// ── Surface ───────────────────────────────────────────────────────────

export function Surface({
  children,
  className,
  padded = true,
}: {
  children: React.ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <div
      className={cx(
        'rounded-tutak-xl border border-line bg-surface shadow-tutak-sm',
        padded && 'p-6',
        className,
      )}
    >
      {children}
    </div>
  );
}

// ── Button ────────────────────────────────────────────────────────────

type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'destructive';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-brand text-white hover:bg-brand-hover',
  secondary: 'bg-brand-surface text-brand hover:brightness-95',
  tertiary: 'bg-transparent text-muted hover:bg-canvas',
  destructive: 'bg-danger-surface text-danger-text hover:brightness-95',
};

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  loading,
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
}) {
  const sizes = {
    sm: 'h-8 px-3 text-[13px]',
    md: 'h-10 px-4 text-[15px]',
    lg: 'h-12 px-5 text-[15px]',
  };

  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-tutak-md font-medium',
        'transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40',
        sizes[size],
        BUTTON_VARIANTS[variant],
        className,
      )}
    >
      {loading ? <Spinner /> : children}
    </button>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden
      className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
    />
  );
}

// ── Field ─────────────────────────────────────────────────────────────

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-[13px] font-medium text-muted">{label}</span>
      {children}
      {error ? (
        <span className="mt-1.5 block text-[12px] text-danger-text">{error}</span>
      ) : hint ? (
        <span className="mt-1.5 block text-[12px] text-faint">{hint}</span>
      ) : null}
    </label>
  );
}

export function Input({
  className,
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...rest}
      className={cx(
        'h-11 w-full rounded-tutak-md border border-line bg-surface px-3.5 text-[15px] text-ink',
        'placeholder:text-faint focus:border-brand focus:outline-none',
        'transition-colors duration-150',
        className,
      )}
    />
  );
}

export function Select({
  className,
  children,
  ...rest
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...rest}
      className={cx(
        'h-11 w-full rounded-tutak-md border border-line bg-surface px-3.5 text-[15px] text-ink',
        'focus:border-brand focus:outline-none transition-colors duration-150',
        className,
      )}
    >
      {children}
    </select>
  );
}

export function Textarea({
  className,
  ...rest
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...rest}
      className={cx(
        'min-h-[88px] w-full rounded-tutak-md border border-line bg-surface p-3.5 text-[15px] text-ink',
        'placeholder:text-faint focus:border-brand focus:outline-none transition-colors duration-150',
        className,
      )}
    />
  );
}

// ── Badge ─────────────────────────────────────────────────────────────

export type BadgeTone = 'available' | 'pending' | 'reserved' | 'neutral' | 'danger';

const BADGE_TONES: Record<BadgeTone, { wrap: string; dot: string }> = {
  available: { wrap: 'bg-available-surface text-available-text', dot: 'bg-available' },
  pending: { wrap: 'bg-pending-surface text-pending-text', dot: 'bg-pending' },
  reserved: { wrap: 'bg-reserved-surface text-reserved-text', dot: 'bg-reserved' },
  danger: { wrap: 'bg-danger-surface text-danger-text', dot: 'bg-danger' },
  neutral: { wrap: 'bg-canvas text-muted', dot: 'bg-faint' },
};

export function Badge({
  children,
  tone = 'neutral',
  dot = true,
}: {
  children: React.ReactNode;
  tone?: BadgeTone;
  dot?: boolean;
}) {
  const t = BADGE_TONES[tone];
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium',
        t.wrap,
      )}
    >
      {dot ? <span className={cx('h-1.5 w-1.5 rounded-full', t.dot)} /> : null}
      {children}
    </span>
  );
}

// ── Page scaffolding ──────────────────────────────────────────────────

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-7 flex items-start justify-between gap-6">
      <div>
        <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-ink">{title}</h1>
        {description ? <p className="mt-1 text-[15px] text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function EmptyState({
  title,
  message,
  action,
}: {
  title: string;
  message?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="text-[15px] font-semibold text-ink">{title}</div>
      {message ? <p className="mt-1.5 max-w-sm text-[14px] text-muted">{message}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

// ── Table ─────────────────────────────────────────────────────────────

export function Table({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-tutak-xl border border-line bg-surface shadow-tutak-sm">
      <table className="w-full border-collapse text-[14px]">{children}</table>
    </div>
  );
}

export function Th({
  children,
  align = 'left',
}: {
  children?: React.ReactNode;
  align?: 'left' | 'right';
}) {
  return (
    <th
      scope="col"
      className={cx(
        'border-b border-line px-5 py-3 text-[12px] font-medium uppercase tracking-[0.04em] text-faint',
        align === 'right' ? 'text-right' : 'text-left',
      )}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  align = 'left',
  className,
  colSpan,
}: {
  children?: React.ReactNode;
  align?: 'left' | 'right';
  className?: string;
  colSpan?: number;
}) {
  return (
    <td
      colSpan={colSpan}
      className={cx(
        'border-b border-line px-5 py-3.5 text-ink last:border-0',
        align === 'right' ? 'text-right' : 'text-left',
        className,
      )}
    >
      {children}
    </td>
  );
}

/** Rows highlight on hover so a wide table stays trackable across columns. */
export function Tr({ children }: { children: React.ReactNode }) {
  return <tr className="transition-colors hover:bg-canvas/60">{children}</tr>;
}

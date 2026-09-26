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

/**
 * A password box with an eye.
 *
 * Its own component rather than a `type="password"` on `Input`, so that a
 * password field without a way to see what was typed is not something a page
 * can produce by accident. Every one of them in the panels goes through here.
 *
 * Why it matters more than it looks: these are typed on phones, where a
 * mistyped character is invisible and the only feedback is a rejected sign-in
 * that blames the person. The admin password in particular is a generated one
 * nobody has memorised, read off another screen — exactly the case where
 * typing blind fails and the failure looks like a wrong password.
 *
 * The box is never revealed by default and reverts on every mount; nothing
 * about the state is remembered anywhere.
 */
export function PasswordInput({
  className,
  showLabel = 'Show password',
  hideLabel = 'Hide password',
  ...rest
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  showLabel?: string;
  hideLabel?: string;
}) {
  const [revealed, setRevealed] = React.useState(false);
  const label = revealed ? hideLabel : showLabel;

  return (
    <div className="relative">
      <Input
        {...rest}
        type={revealed ? 'text' : 'password'}
        // Room for the button, so a long value never runs under it.
        className={cx('pr-10', className)}
      />
      <button
        type="button"
        onClick={() => setRevealed((on) => !on)}
        // `tabIndex={-1}` deliberately NOT set: someone who cannot see the
        // field is exactly who may need to check what a password manager or a
        // phone keyboard put there, and taking it out of the tab order would
        // put it out of their reach.
        //
        // The label says what pressing it does, not what is on screen — a
        // screen-reader user gets nothing from being told about pixels.
        aria-label={label}
        aria-pressed={revealed}
        title={label}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-secondary transition-colors hover:text-ink"
      >
        {revealed ? <EyeOffGlyph /> : <EyeGlyph />}
      </button>
    </div>
  );
}

function EyeGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function EyeOffGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3 3l18 18M10.6 5.2C11.05 5.1 11.51 5 12 5c6.4 0 10 7 10 7-.63 1.2-1.6 2.6-2.9 3.9M6.5 6.6C4 8.3 2 12 2 12s3.6 7 10 7c1.36 0 2.56-.31 3.6-.8"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M9.9 9.9a3 3 0 0 0 4.2 4.2"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
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

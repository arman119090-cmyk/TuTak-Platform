import Link from 'next/link';
import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from 'react';
import { Star } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatMoney, type CurrencyCode } from '@/lib/money';

/** Presentational building blocks shared by the storefront and the admin panel. */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'outline' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-2 font-medium rounded-[var(--radius-sm)] transition-colors duration-150 disabled:opacity-45 disabled:cursor-not-allowed select-none';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-ink text-white hover:bg-ink-soft',
  secondary: 'bg-surface-2 text-ink hover:bg-surface-3',
  ghost: 'text-ink hover:bg-surface-2',
  outline: 'border border-line-strong text-ink bg-surface hover:border-ink',
  danger: 'bg-sale text-white hover:opacity-90',
};

/** Minimum 44px touch targets on the two larger sizes — phones are the point. */
const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'h-9 px-3 text-[13px]',
  md: 'h-11 px-5 text-sm',
  lg: 'h-13 px-7 text-[15px] min-h-[52px]',
};

export const buttonClass = (
  variant: ButtonVariant = 'primary',
  size: ButtonSize = 'md',
  extra?: string,
): string => cn(BUTTON_BASE, BUTTON_VARIANTS[variant], BUTTON_SIZES[size], extra);

export const Button = ({
  variant = 'primary',
  size = 'md',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) => (
  <button className={buttonClass(variant, size, className)} {...props} />
);

export const LinkButton = ({
  variant = 'primary',
  size = 'md',
  className,
  href,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  href: string;
}) => <Link href={href} className={buttonClass(variant, size, className)} {...props} />;

export const Badge = ({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: 'neutral' | 'sale' | 'new' | 'hit' | 'stock' | 'premium';
  children: ReactNode;
  className?: string;
}) => {
  const tones: Record<string, string> = {
    neutral: 'bg-surface-3 text-ink-soft',
    sale: 'bg-sale text-white',
    new: 'bg-ink text-white',
    hit: 'bg-accent text-white',
    stock: 'bg-success-soft text-success',
    premium: 'bg-accent-soft text-accent-strong',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-[var(--radius-xs)] px-2 py-[3px] text-[10px] font-semibold uppercase tracking-[0.08em]',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
};

export const Price = ({
  amountMinor,
  oldAmountMinor,
  currency = 'AMD',
  size = 'md',
  className,
}: {
  amountMinor: number;
  oldAmountMinor?: number | null;
  currency?: CurrencyCode;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) => {
  const sizes = {
    sm: 'text-[15px]',
    md: 'text-lg',
    lg: 'text-[26px]',
  } as const;
  return (
    <span className={cn('flex flex-wrap items-baseline gap-2', className)}>
      <span className={cn('font-semibold tabular-nums', sizes[size])}>
        {formatMoney(amountMinor, currency)}
      </span>
      {oldAmountMinor && oldAmountMinor > amountMinor ? (
        <span className="text-[13px] text-muted line-through tabular-nums">
          {formatMoney(oldAmountMinor, currency)}
        </span>
      ) : null}
    </span>
  );
};

export const Rating = ({
  value,
  count,
  size = 14,
  showValue = true,
  className,
}: {
  value: number;
  count?: number;
  size?: number;
  showValue?: boolean;
  className?: string;
}) => (
  <span className={cn('inline-flex items-center gap-1.5 text-[13px] text-muted', className)}>
    <span className="inline-flex" aria-hidden>
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          width={size}
          height={size}
          className={star <= Math.round(value) ? 'fill-accent text-accent' : 'text-line-strong'}
          strokeWidth={1.5}
        />
      ))}
    </span>
    {showValue ? (
      <span className="font-medium text-ink-soft tabular-nums">{value.toFixed(1)}</span>
    ) : null}
    {typeof count === 'number' ? <span className="tabular-nums">({count})</span> : null}
  </span>
);

const FIELD_BASE =
  'w-full rounded-[var(--radius-sm)] border border-line bg-surface px-3.5 text-sm text-ink placeholder:text-muted/70 transition-colors focus:border-ink focus:outline-none disabled:bg-surface-2';

export const Input = ({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) => (
  <input className={cn(FIELD_BASE, 'h-11', className)} {...props} />
);

export const Textarea = ({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea className={cn(FIELD_BASE, 'py-2.5 min-h-24 resize-y', className)} {...props} />
);

export const Select = ({
  className,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) => (
  <select
    className={cn(FIELD_BASE, 'h-11 pr-8 appearance-none bg-no-repeat', className)}
    style={{
      backgroundImage:
        "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1.5 6 6.5l5-5' stroke='%2378716a' stroke-width='1.6' fill='none' stroke-linecap='round'/%3E%3C/svg%3E\")",
      backgroundPosition: 'right 12px center',
    }}
    {...props}
  >
    {children}
  </select>
);

export const Field = ({
  label,
  hint,
  error,
  required,
  children,
  className,
}: {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) => (
  <label className={cn('block', className)}>
    <span className="mb-1.5 flex items-baseline gap-1 text-[13px] font-medium text-ink-soft">
      {label}
      {required ? <span className="text-sale">*</span> : null}
    </span>
    {children}
    {error ? (
      <span className="mt-1 block text-[12px] text-sale">{error}</span>
    ) : hint ? (
      <span className="mt-1 block text-[12px] text-muted">{hint}</span>
    ) : null}
  </label>
);

export const Checkbox = ({
  label,
  description,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode; description?: string }) => (
  <label className={cn('flex cursor-pointer items-start gap-3 py-1.5', className)}>
    <input
      type="checkbox"
      className="mt-0.5 h-[18px] w-[18px] shrink-0 accent-[var(--color-ink)]"
      {...props}
    />
    <span className="text-sm leading-snug">
      <span className="text-ink">{label}</span>
      {description ? (
        <span className="mt-0.5 block text-[12px] text-muted">{description}</span>
      ) : null}
    </span>
  </label>
);

export const Chip = ({
  active,
  children,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) => (
  <button
    type="button"
    className={cn(
      'inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-[13px] transition-colors',
      active
        ? 'border-ink bg-ink text-white'
        : 'border-line-strong bg-surface text-ink-soft hover:border-ink',
      className,
    )}
    {...props}
  >
    {children}
  </button>
);

export const SectionHeading = ({
  title,
  subtitle,
  action,
  className,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  className?: string;
}) => (
  <div className={cn('mb-6 flex flex-wrap items-end justify-between gap-3', className)}>
    <div>
      <h2 className="text-[26px] md:text-[32px]">{title}</h2>
      {subtitle ? <p className="mt-1.5 max-w-2xl text-sm text-muted">{subtitle}</p> : null}
    </div>
    {action}
  </div>
);

export const EmptyState = ({
  icon,
  title,
  text,
  action,
}: {
  icon?: ReactNode;
  title: string;
  text?: string;
  action?: ReactNode;
}) => (
  <div className="flex flex-col items-center justify-center rounded-[var(--radius-lg)] border border-dashed border-line-strong bg-surface px-6 py-16 text-center">
    {icon ? <div className="mb-4 text-muted">{icon}</div> : null}
    <h3 className="text-xl">{title}</h3>
    {text ? <p className="mt-2 max-w-md text-sm text-muted">{text}</p> : null}
    {action ? <div className="mt-6">{action}</div> : null}
  </div>
);

export const Skeleton = ({ className }: { className?: string }) => (
  <div className={cn('skeleton rounded-[var(--radius-sm)]', className)} />
);

export const Breadcrumbs = ({ items }: { items: { label: string; href?: string }[] }) => (
  <nav aria-label="breadcrumb" className="hide-scrollbar mb-5 overflow-x-auto">
    <ol className="flex items-center gap-2 whitespace-nowrap text-[13px] text-muted">
      {items.map((item, index) => (
        <li key={`${item.label}-${index}`} className="flex items-center gap-2">
          {item.href && index < items.length - 1 ? (
            <Link href={item.href} className="hover:text-ink">
              {item.label}
            </Link>
          ) : (
            <span className={index === items.length - 1 ? 'text-ink-soft' : undefined}>
              {item.label}
            </span>
          )}
          {index < items.length - 1 ? (
            <span aria-hidden className="text-line-strong">
              /
            </span>
          ) : null}
        </li>
      ))}
    </ol>
  </nav>
);

export const Divider = ({ className }: { className?: string }) => (
  <hr className={cn('border-0 border-t border-line', className)} />
);

export const Alert = ({
  tone = 'info',
  title,
  children,
}: {
  tone?: 'info' | 'warning' | 'error' | 'success';
  title?: string;
  children: ReactNode;
}) => {
  const tones = {
    info: 'bg-surface-2 text-ink-soft border-line',
    warning: 'bg-[#FBF3E2] text-[#7A5A12] border-[#EBDCBB]',
    error: 'bg-[#FBEAE8] text-[#8F2C23] border-[#F0CFCB]',
    success: 'bg-success-soft text-success border-[#C9E0D6]',
  } as const;
  return (
    <div className={cn('rounded-[var(--radius-sm)] border px-4 py-3 text-[13px]', tones[tone])}>
      {title ? <div className="mb-0.5 font-semibold">{title}</div> : null}
      {children}
    </div>
  );
};

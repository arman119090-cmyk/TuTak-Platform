import Link from "next/link";
import type { ReactNode } from "react";
import { tone as toneOf } from "@/lib/admin/format";

// Small presentational building blocks for the back office (server-safe).

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}

export function Card({
  title,
  children,
  actions,
  id,
  className,
}: {
  title?: string;
  children: ReactNode;
  actions?: ReactNode;
  id?: string;
  className?: string;
}) {
  return (
    <section id={id} className={`adm-card ${className ?? ""}`} aria-labelledby={title && id ? `${id}-h` : undefined}>
      {title || actions ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title ? (
            <h2 id={id ? `${id}-h` : undefined} className="text-base font-semibold">
              {title}
            </h2>
          ) : (
            <span />
          )}
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function Badge({ children, tone, status }: { children: ReactNode; tone?: "ok" | "warn" | "bad" | "muted"; status?: string }) {
  const t = tone ?? (status ? toneOf(status) : "muted");
  return <span className={`adm-badge adm-badge-${t}`}>{children}</span>;
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="adm-card">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
      {hint ? <div className="mt-1 text-xs text-muted">{hint}</div> : null}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-xl bg-mist px-4 py-6 text-center text-sm text-muted">{children}</p>;
}

type InputProps = {
  label: string;
  name: string;
  defaultValue?: string | number | null;
  type?: string;
  hint?: ReactNode;
  required?: boolean;
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number | string;
  maxLength?: number;
  pattern?: string;
  autoComplete?: string;
  className?: string;
  readOnly?: boolean;
  inputMode?: "numeric" | "text" | "email" | "tel" | "decimal" | "url";
};

let seq = 0;
const uid = (name: string) => `f-${name.replace(/[^a-zA-Z0-9_-]/g, "-")}-${(seq = (seq + 1) % 1_000_000)}`;

export function Field({ label, name, defaultValue, type = "text", hint, className, ...rest }: InputProps) {
  const id = uid(name);
  return (
    <div className={className}>
      <label htmlFor={id} className="label">
        {label}
        {rest.required ? <span aria-hidden="true"> *</span> : null}
      </label>
      <input id={id} name={name} type={type} defaultValue={defaultValue ?? ""} className="field" {...rest} />
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

export function TextArea({
  label,
  name,
  defaultValue,
  rows = 3,
  hint,
  className,
  maxLength,
  required,
}: {
  label: string;
  name: string;
  defaultValue?: string | null;
  rows?: number;
  hint?: ReactNode;
  className?: string;
  maxLength?: number;
  required?: boolean;
}) {
  const id = uid(name);
  return (
    <div className={className}>
      <label htmlFor={id} className="label">
        {label}
      </label>
      <textarea
        id={id}
        name={name}
        rows={rows}
        defaultValue={defaultValue ?? ""}
        className="field"
        maxLength={maxLength}
        required={required}
      />
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

export function Select({
  label,
  name,
  defaultValue,
  options,
  empty,
  hint,
  className,
  required,
}: {
  label: string;
  name: string;
  defaultValue?: string | number | null;
  options: { value: string; label: string }[] | Record<string, string>;
  /** Label of an empty ("not set") option. */
  empty?: string;
  hint?: ReactNode;
  className?: string;
  required?: boolean;
}) {
  const id = uid(name);
  const opts = Array.isArray(options) ? options : Object.entries(options).map(([value, label]) => ({ value, label }));
  return (
    <div className={className}>
      <label htmlFor={id} className="label">
        {label}
      </label>
      <select id={id} name={name} defaultValue={defaultValue === null || defaultValue === undefined ? "" : String(defaultValue)} className="field" required={required}>
        {empty !== undefined ? <option value="">{empty}</option> : null}
        {opts.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

export function Check({ label, name, defaultChecked, value }: { label: ReactNode; name: string; defaultChecked?: boolean; value?: string }) {
  return (
    <label className="adm-check">
      <input type="checkbox" name={name} value={value ?? "on"} defaultChecked={defaultChecked} />
      <span>{label}</span>
    </label>
  );
}

export function Hidden({ name, value }: { name: string; value: string }) {
  return <input type="hidden" name={name} value={value} />;
}

export function LinkButton({ href, children, variant = "ghost" }: { href: string; children: ReactNode; variant?: "primary" | "ghost" }) {
  return (
    <Link href={href} className={variant === "primary" ? "btn btn-primary" : "btn btn-ghost"}>
      {children}
    </Link>
  );
}

export function Pager({ page, pages, href }: { page: number; pages: number; href: (p: number) => string }) {
  if (pages <= 1) return null;
  return (
    <nav aria-label="Страницы" className="mt-4 flex items-center gap-2 text-sm">
      {page > 1 ? (
        <Link className="btn btn-ghost" href={href(page - 1)}>
          ← Назад
        </Link>
      ) : null}
      <span className="px-2 text-muted">
        Стр. {page} из {pages}
      </span>
      {page < pages ? (
        <Link className="btn btn-ghost" href={href(page + 1)}>
          Вперёд →
        </Link>
      ) : null}
    </nav>
  );
}

/** Builds a query string from defined values. */
export function qs(params: Record<string, string | number | null | undefined>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== "") u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : "";
}

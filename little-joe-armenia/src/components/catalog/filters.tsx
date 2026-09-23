"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import type { ProductFormat } from "@/generated/prisma/enums";
import type { Facets } from "@/lib/catalog";
import { fmt } from "@/i18n/messages";
import { useI18n } from "@/i18n/provider";
import { track } from "@/components/analytics/track";
import { Sheet } from "@/components/ui/sheet";
import { IconFilter, IconSearch } from "@/components/ui/icons";

// All filter state lives in the URL (shareable, back-button friendly).
// Filtered URLs are noindex + canonical to the unfiltered page (see page).

const LIST_KEYS = ["collection", "family", "intensity", "format", "color"] as const;
type ListKey = (typeof LIST_KEYS)[number];

function useFilterUrl() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const set = (mutate: (p: URLSearchParams) => void) => {
    const next = new URLSearchParams(params.toString());
    mutate(next);
    const qs = next.toString();
    start(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  };
  const listValues = (k: ListKey) => (params.get(k) ?? "").split(",").filter(Boolean);
  const toggle = (k: ListKey, v: string) =>
    set((p) => {
      const cur = (p.get(k) ?? "").split(",").filter(Boolean);
      const next = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v];
      if (next.length) p.set(k, next.join(","));
      else p.delete(k);
    });
  const flag = (k: string) => params.get(k) === "1";
  const toggleFlag = (k: string) => set((p) => (p.get(k) === "1" ? p.delete(k) : p.set(k, "1")));
  const activeCount =
    LIST_KEYS.reduce((n, k) => n + listValues(k).length, 0) +
    ["stock", "bestseller", "new", "gift"].filter(flag).length +
    (params.get("min") ? 1 : 0) +
    (params.get("max") ? 1 : 0);
  return { params, set, listValues, toggle, flag, toggleFlag, pending, activeCount, clear: () => set((p) => { for (const k of [...LIST_KEYS, "stock", "bestseller", "new", "gift", "min", "max"]) p.delete(k); }) };
}

export function SearchBox() {
  const { params } = useFilterUrl();
  // Remount when the URL's q changes (back/forward) instead of syncing state in an effect.
  return <SearchInput key={params.get("q") ?? ""} initial={params.get("q") ?? ""} />;
}

function SearchInput({ initial }: { initial: string }) {
  const { m } = useI18n();
  const { set } = useFilterUrl();
  const [q, setQ] = useState(initial);
  return (
    <form
      role="search"
      className="relative w-full"
      onSubmit={(e) => {
        e.preventDefault();
        const term = q.trim();
        if (term) track("search", { search_term: term });
        set((p) => (term ? p.set("q", term) : p.delete("q")));
      }}
    >
      <label htmlFor="catalog-q" className="sr-only">
        {m.catalog.searchLabel}
      </label>
      <IconSearch className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted" width={20} height={20} />
      <input
        id="catalog-q"
        type="search"
        name="q"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={m.catalog.searchPlaceholder}
        maxLength={80}
        enterKeyHint="search"
        className="field rounded-full pl-12"
      />
    </form>
  );
}

export function SortSelect() {
  const { m } = useI18n();
  const { params, set } = useFilterUrl();
  const options = [
    ["featured", m.catalog.sortFeatured],
    ["price-asc", m.catalog.sortPriceAsc],
    ["price-desc", m.catalog.sortPriceDesc],
    ["new", m.catalog.sortNew],
    ["name", m.catalog.sortName],
  ] as const;
  return (
    <label className="flex min-w-0 items-center gap-2 text-sm">
      <span className="sr-only sm:not-sr-only sm:text-muted">{m.catalog.sort}</span>
      <select
        aria-label={m.catalog.sort}
        className="field min-h-11 w-auto max-w-[11rem] rounded-full py-2 pr-9 text-sm sm:max-w-none"
        value={params.get("sort") ?? "featured"}
        onChange={(e) => set((p) => (e.target.value === "featured" ? p.delete("sort") : p.set("sort", e.target.value)))}
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

function FilterBody({ facets }: { facets: Facets }) {
  const { m } = useI18n();
  const f = useFilterUrl();
  const formatLabel = (x: ProductFormat) => m.product.formats[x];
  return (
    <div className="space-y-7">
      <Group title={m.catalog.availability}>
        <Check checked={f.flag("stock")} onChange={() => f.toggleFlag("stock")} label={m.catalog.inStockOnly} />
      </Group>
      <Group title={m.catalog.highlights}>
        <div className="flex flex-wrap gap-2">
          <Chip active={f.flag("bestseller")} onClick={() => f.toggleFlag("bestseller")} label={m.catalog.bestseller} />
          <Chip active={f.flag("new")} onClick={() => f.toggleFlag("new")} label={m.catalog.new} />
          <Chip active={f.flag("gift")} onClick={() => f.toggleFlag("gift")} label={m.catalog.gift} />
        </div>
      </Group>
      {facets.collections.length > 1 ? (
        <Group title={m.catalog.collection}>
          {facets.collections.map((c) => (
            <Check key={c.slug} checked={f.listValues("collection").includes(c.slug)} onChange={() => f.toggle("collection", c.slug)} label={c.name} count={c.count} />
          ))}
        </Group>
      ) : null}
      {facets.families.length > 0 ? (
        <Group title={m.catalog.fragranceFamily}>
          <div className="flex flex-wrap gap-2">
            {facets.families.map((x) => (
              <Chip key={x.slug} active={f.listValues("family").includes(x.slug)} onClick={() => f.toggle("family", x.slug)} label={x.name} />
            ))}
          </div>
        </Group>
      ) : null}
      {facets.intensities.length > 0 ? (
        <Group title={m.catalog.intensity}>
          <div className="flex flex-wrap gap-2">
            {facets.intensities.map((n) => (
              <Chip
                key={n}
                active={f.listValues("intensity").includes(String(n))}
                onClick={() => f.toggle("intensity", String(n))}
                label={m.product.intensityLevels[String(n) as "1"]}
              />
            ))}
          </div>
        </Group>
      ) : null}
      {facets.formats.length > 1 ? (
        <Group title={m.catalog.format}>
          {facets.formats.map((x) => (
            <Check key={x} checked={f.listValues("format").includes(x)} onChange={() => f.toggle("format", x)} label={formatLabel(x)} />
          ))}
        </Group>
      ) : null}
      {facets.colors.length > 0 ? (
        <Group title={m.catalog.color}>
          <div className="flex flex-wrap gap-2">
            {facets.colors.map((c) => (
              <Chip key={c} active={f.listValues("color").includes(c)} onClick={() => f.toggle("color", c)} label={c} />
            ))}
          </div>
        </Group>
      ) : null}
      {facets.priceMax > facets.priceMin ? (
        <Group title={m.catalog.price}>
          <PriceRange min={facets.priceMin} max={facets.priceMax} />
        </Group>
      ) : null}
    </div>
  );
}

function PriceRange({ min, max }: { min: number; max: number }) {
  const { m } = useI18n();
  const { params, set } = useFilterUrl();
  const [lo, setLo] = useState(params.get("min") ?? "");
  const [hi, setHi] = useState(params.get("max") ?? "");
  const apply = () =>
    set((p) => {
      const clean = (v: string) => v.replace(/\D/g, "");
      if (clean(lo)) p.set("min", clean(lo));
      else p.delete("min");
      if (clean(hi)) p.set("max", clean(hi));
      else p.delete("max");
    });
  return (
    <div className="grid grid-cols-2 gap-2">
      <label>
        <span className="label">{m.catalog.priceFrom}</span>
        <input className="field" inputMode="numeric" placeholder={String(min)} value={lo} onChange={(e) => setLo(e.target.value)} onBlur={apply} />
      </label>
      <label>
        <span className="label">{m.catalog.priceTo}</span>
        <input className="field" inputMode="numeric" placeholder={String(max)} value={hi} onChange={(e) => setHi(e.target.value)} onBlur={apply} />
      </label>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset>
      <legend className="mb-3 text-sm font-bold">{title}</legend>
      <div className="space-y-1">{children}</div>
    </fieldset>
  );
}

function Check({ checked, onChange, label, count }: { checked: boolean; onChange: () => void; label: string; count?: number }) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-3 text-[0.95rem]">
      <input type="checkbox" checked={checked} onChange={onChange} className="size-5 accent-ink" />
      <span className="flex-1">{label}</span>
      {count !== undefined ? <span className="text-sm text-muted">{count}</span> : null}
    </label>
  );
}

function Chip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" aria-pressed={active} onClick={onClick} className="chip">
      {label}
    </button>
  );
}

export function DesktopFilters({ facets }: { facets: Facets }) {
  const { m } = useI18n();
  const f = useFilterUrl();
  return (
    <aside className="hidden lg:block" aria-label={m.catalog.filters}>
      <div className="card sticky top-24 p-5">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-bold">{m.catalog.filters}</h2>
          {f.activeCount > 0 ? (
            <button type="button" onClick={f.clear} className="tap text-sm font-semibold underline underline-offset-4">
              {m.catalog.clearAll}
            </button>
          ) : null}
        </div>
        <FilterBody facets={facets} />
      </div>
    </aside>
  );
}

export function MobileFilters({ facets, count }: { facets: Facets; count: number }) {
  const { m } = useI18n();
  const f = useFilterUrl();
  const [open, setOpen] = useState(false);
  return (
    <div className="lg:hidden">
      <button type="button" className="chip" onClick={() => setOpen(true)} aria-expanded={open} data-testid="open-filters">
        <IconFilter width={18} height={18} />
        {m.catalog.filters}
        {f.activeCount > 0 ? <span className="grid size-5 place-items-center rounded-full bg-ink text-[0.7rem] font-bold text-white">{f.activeCount}</span> : null}
      </button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        label={m.catalog.filters}
        side="bottom"
        closeLabel={m.common.close}
        footer={
          <div className="flex gap-2">
            <button type="button" className="btn btn-ghost flex-1" onClick={f.clear}>
              {m.catalog.clearAll}
            </button>
            <button type="button" className="btn btn-primary flex-[2]" onClick={() => setOpen(false)}>
              {fmt(m.catalog.showResults, { count })}
            </button>
          </div>
        }
      >
        <div className="px-5 py-5">
          <FilterBody facets={facets} />
        </div>
      </Sheet>
    </div>
  );
}

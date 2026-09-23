"use client";

import Link from "next/link";
import { useState } from "react";
import { useI18n } from "@/i18n/provider";
import { readLocal, useLocal, writeLocal } from "@/lib/local-store";
import { paths } from "@/lib/paths";
import { IconCompare, IconShare } from "@/components/ui/icons";

// Share (Web Share API → clipboard fallback) and compare list (≤4 ids,
// stored locally; the compare page URL carries them so it is shareable).

const COMPARE_KEY = "lj_compare";
export const COMPARE_LIMIT = 4;

function parseCompare(raw: string | null | undefined): string[] {
  try {
    const v = JSON.parse(raw ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, COMPARE_LIMIT) : [];
  } catch {
    return [];
  }
}
export function readCompare(): string[] {
  return parseCompare(readLocal(COMPARE_KEY));
}
export function writeCompare(ids: string[]) {
  writeLocal(COMPARE_KEY, JSON.stringify(ids.slice(0, COMPARE_LIMIT)));
}

export function ShareButton({ title }: { title: string }) {
  const { m } = useI18n();
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="tap inline-flex items-center gap-2 rounded-full px-3 text-sm font-semibold hover:bg-mist"
      onClick={async () => {
        const url = window.location.href.split("?")[0]!;
        try {
          if (navigator.share) await navigator.share({ title, url });
          else {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }
        } catch {
          /* dismissed */
        }
      }}
    >
      <IconShare width={18} height={18} />
      <span aria-live="polite">{copied ? m.product.linkCopied : m.product.share}</span>
    </button>
  );
}

export function CompareToggle({ productId }: { productId: string }) {
  const { m, locale } = useI18n();
  const ids = parseCompare(useLocal(COMPARE_KEY));
  const [note, setNote] = useState<string | null>(null);
  const active = ids.includes(productId);
  return (
    <div className="inline-flex items-center gap-2">
      <button
        type="button"
        aria-pressed={active}
        className="tap inline-flex items-center gap-2 rounded-full px-3 text-sm font-semibold hover:bg-mist aria-pressed:bg-ink aria-pressed:text-white"
        onClick={() => {
          let next: string[];
          if (active) next = ids.filter((x) => x !== productId);
          else if (ids.length >= COMPARE_LIMIT) {
            setNote(m.compare.limit);
            return;
          } else next = [...ids, productId];
          setNote(null);
          writeCompare(next);
        }}
      >
        <IconCompare width={18} height={18} />
        {active ? m.product.removeFromCompare : m.product.addToCompare}
      </button>
      {ids.length > 0 ? (
        <Link href={paths.compare(locale, ids)} className="tap inline-flex items-center text-sm font-semibold underline underline-offset-4">
          {m.product.compare} ({ids.length})
        </Link>
      ) : null}
      {note ? (
        <span role="status" className="text-sm text-warn">
          {note}
        </span>
      ) : null}
    </div>
  );
}

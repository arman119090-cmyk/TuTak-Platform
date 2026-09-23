"use client";

import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useState, useTransition } from "react";
import { findScentsAction, type FinderResult } from "@/app/actions/finder";
import { fmt } from "@/i18n/messages";
import { useI18n } from "@/i18n/provider";
import type { FinderAnswers, Reason } from "@/lib/domain/scent";
import { formatAmd } from "@/lib/money";
import { paths } from "@/lib/paths";
import { ProductImage } from "@/components/product/product-image";

type Step = { key: keyof FinderAnswers; q: string; options: { value: string; label: string }[] };

export function ScentFinder({ demo }: { demo: boolean }) {
  const { m, locale } = useI18n();
  const reduce = useReducedMotion();
  const steps: Step[] = [
    { key: "direction", q: m.finder.q1, options: [["fresh", m.finder.q1fresh], ["sweet", m.finder.q1sweet], ["fruity", m.finder.q1fruity], ["woody", m.finder.q1woody], ["floral", m.finder.q1floral]].map(([value, label]) => ({ value: value!, label: label! })) },
    { key: "strength", q: m.finder.q2, options: [["subtle", m.finder.q2subtle], ["balanced", m.finder.q2balanced], ["strong", m.finder.q2strong]].map(([value, label]) => ({ value: value!, label: label! })) },
    { key: "place", q: m.finder.q3, options: [["car", m.finder.q3car], ["home", m.finder.q3home], ["office", m.finder.q3office]].map(([value, label]) => ({ value: value!, label: label! })) },
    { key: "purpose", q: m.finder.q4, options: [["personal", m.finder.q4personal], ["gift", m.finder.q4gift]].map(([value, label]) => ({ value: value!, label: label! })) },
  ];
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Partial<FinderAnswers>>({});
  const [results, setResults] = useState<{ results: FinderResult; familyNames: Record<string, string> } | null>(null);
  const [error, setError] = useState(false);
  const [pending, start] = useTransition();
  const current = steps[step];

  const reasonText = (r: Reason, names: Record<string, string>) => {
    switch (r.kind) {
      case "family":
        return fmt(m.finder.reasonFamily, { family: names[r.familySlug] ?? r.familySlug });
      case "axis":
        return fmt(m.finder.reasonAxis, { axis: m.product.axes[r.axis] });
      case "intensity":
        return fmt(m.finder.reasonIntensity, { level: m.product.intensityLevels[String(r.level) as "1"] });
      case "gift":
        return m.finder.reasonGift;
      case "bestseller":
        return m.finder.reasonBestseller;
    }
  };

  const submit = (final: FinderAnswers) =>
    start(async () => {
      try {
        setError(false);
        setResults(await findScentsAction(locale, final));
      } catch {
        setError(true);
      }
    });

  if (results) {
    return (
      <div aria-live="polite">
        <h2 className="text-h2 font-extrabold">{m.finder.resultsTitle}</h2>
        {results.results.length === 0 ? (
          <div className="mt-6 rounded-[var(--radius-card)] bg-mist p-8">
            <p>{m.finder.resultsEmpty}</p>
            <Link href={paths.shop(locale)} className="btn btn-primary mt-5">
              {m.home.ctaShop}
            </Link>
          </div>
        ) : (
          <ol className="mt-8 grid gap-5 md:grid-cols-3">
            {results.results.map(({ product, reasons }, i) => (
              <li key={product.id} className="overflow-hidden rounded-[var(--radius-card)] bg-card ring-1 ring-line" data-testid="finder-result">
                <Link href={paths.product(locale, product.slug)} className="block aspect-[4/3] overflow-hidden" style={{ background: product.accent }}>
                  <ProductImage media={product.image} accent={product.accent} sizes="(min-width: 768px) 30vw, 92vw" priority={i === 0} />
                </Link>
                <div className="p-5">
                  <p className="text-xs font-bold text-muted">#{i + 1}</p>
                  <h3 className="text-lg font-bold">
                    <Link href={paths.product(locale, product.slug)} className="hover:underline">
                      {product.name}
                    </Link>
                  </h3>
                  {product.priceAmd !== null ? <p className="mt-1 font-semibold tabular-nums">{formatAmd(product.priceAmd, locale)}</p> : null}
                  <p className="mt-4 text-sm font-semibold">{m.finder.why}</p>
                  <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-ink-2">
                    {reasons.map((r, j) => (
                      <li key={j}>{reasonText(r, results.familyNames)}</li>
                    ))}
                  </ul>
                </div>
              </li>
            ))}
          </ol>
        )}
        <p className="mt-6 text-sm text-muted">{m.finder.dataNote}</p>
        {demo ? <p className="mt-1 text-sm text-warn">{m.finder.demoNote}</p> : null}
        <button type="button" className="btn btn-ghost mt-6" onClick={() => { setResults(null); setAnswers({}); setStep(0); }}>
          {m.finder.restart}
        </button>
      </div>
    );
  }

  if (!current) return null;
  const chosen = answers[current.key];

  return (
    <div>
      <div className="mb-8 flex items-center gap-3">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-line" aria-hidden="true">
          <div className="h-full rounded-full bg-ink transition-[width] duration-500" style={{ width: `${((step + 1) / steps.length) * 100}%` }} />
        </div>
        <p className="text-sm text-muted">{fmt(m.finder.step, { n: step + 1, total: steps.length })}</p>
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.fieldset
          key={current.key}
          initial={reduce ? false : { opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, x: -24 }}
          transition={{ duration: 0.25 }}
        >
          <legend className="text-h2 font-extrabold">{current.q}</legend>
          <div className="mt-8 grid gap-3 sm:grid-cols-2" role="radiogroup">
            {current.options.map((o) => (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={chosen === o.value}
                onClick={() => setAnswers((a) => ({ ...a, [current.key]: o.value }))}
                className="flex min-h-16 items-center rounded-2xl bg-card px-5 text-left text-lg font-semibold ring-1 ring-line transition hover:ring-ink aria-checked:bg-ink aria-checked:text-white aria-checked:ring-ink"
              >
                {o.label}
              </button>
            ))}
          </div>
        </motion.fieldset>
      </AnimatePresence>
      {error ? (
        <p role="alert" className="mt-4 text-bad">
          {m.common.networkError}
        </p>
      ) : null}
      <div className="mt-10 flex gap-3">
        {step > 0 ? (
          <button type="button" className="btn btn-ghost" onClick={() => setStep((s) => s - 1)}>
            {m.finder.back}
          </button>
        ) : null}
        <button
          type="button"
          className="btn btn-primary"
          disabled={!chosen || pending}
          data-testid="finder-next"
          onClick={() => {
            if (step < steps.length - 1) setStep((s) => s + 1);
            else submit(answers as FinderAnswers);
          }}
        >
          {step < steps.length - 1 ? m.finder.next : m.finder.seeResults}
        </button>
      </div>
    </div>
  );
}

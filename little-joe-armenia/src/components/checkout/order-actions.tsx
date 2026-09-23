"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { retryPaymentAction } from "@/app/actions/checkout";
import { useI18n } from "@/i18n/provider";

/** While awaiting the provider's callback, re-read the order status a few times. */
export function OrderRefresh() {
  const router = useRouter();
  const { m } = useI18n();
  useEffect(() => {
    let n = 0;
    const id = setInterval(() => {
      n++;
      router.refresh();
      if (n >= 10) clearInterval(id);
    }, 3000);
    return () => clearInterval(id);
  }, [router]);
  return (
    <button type="button" className="btn btn-ghost mt-4" onClick={() => router.refresh()}>
      {m.order.refresh}
    </button>
  );
}

export function RetryPayment({ number, token }: { number: string; token: string }) {
  const { m, locale } = useI18n();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="mt-4">
      <button
        type="button"
        className="btn btn-primary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            try {
              const r = await retryPaymentAction(locale, number, token);
              if (!r.ok) {
                setError(r.error === "OUT_OF_STOCK" ? m.checkout.outOfStock : m.common.genericError);
                return;
              }
              if (r.next.kind === "payment" && r.next.start.kind === "redirect") window.location.assign(r.next.start.url);
              else if (r.next.kind === "navigate") window.location.assign(r.next.url);
            } catch {
              setError(m.common.networkError);
            }
          })
        }
      >
        {m.order.retryPayment}
      </button>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-bad">
          {error}
        </p>
      ) : null}
    </div>
  );
}

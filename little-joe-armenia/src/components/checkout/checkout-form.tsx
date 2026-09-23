"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { PaymentProviderCode } from "@/generated/prisma/enums";
import type { CartSnapshot } from "@/app/actions/cart";
import { placeOrderAction, type CheckoutResult } from "@/app/actions/checkout";
import { fmt, type Messages } from "@/i18n/messages";
import { useI18n } from "@/i18n/provider";
import { REGION_CODES } from "@/lib/armenia";
import { formatAmd } from "@/lib/money";
import { paths } from "@/lib/paths";
import { deliveryPrice } from "@/lib/domain/pricing";
import { checkoutSchema, type CheckoutInput } from "@/lib/validation/checkout";
import { track } from "@/components/analytics/track";
import { TrackOnMount } from "@/components/analytics/track-on-mount";
import { useCartUI } from "@/components/cart/cart-ui";
import { ProductImage } from "@/components/product/product-image";
import type { PaymentStart } from "@/lib/payments/types";

type Delivery = { code: string; name: string; eta: string | null; priceAmd: number; freeFromAmd: number | null; regions: string[] };
type Address = { id: string; region: string; city: string; street: string; building: string; apartment: string; entrance: string; floor: string; comment: string };

function newKey(): string {
  const a = new Uint8Array(18);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function CheckoutForm({
  cart,
  delivery,
  payments,
  sandbox,
  signedIn,
  defaults,
  addresses,
}: {
  cart: CartSnapshot;
  delivery: Delivery[];
  payments: PaymentProviderCode[];
  sandbox: boolean;
  signedIn: boolean;
  defaults: { name: string; phone: string; email: string };
  addresses: Address[];
}) {
  const { m, locale } = useI18n();
  const router = useRouter();
  const ui = useCartUI();
  const [pending, start] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);
  const [redirecting, setRedirecting] = useState<PaymentStart | null>(null);
  // One key per checkout attempt; kept across retries of the same submit so
  // a double click or a lost response can never create two orders.
  const keyRef = useRef<string>("");
  if (!keyRef.current) keyRef.current = newKey();

  const first = addresses[0];
  const form = useForm<CheckoutInput>({
    resolver: zodResolver(checkoutSchema),
    mode: "onTouched",
    defaultValues: {
      idempotencyKey: keyRef.current,
      name: defaults.name,
      phone: defaults.phone,
      email: defaults.email,
      region: (first?.region as CheckoutInput["region"]) ?? "ER",
      city: first?.city ?? "",
      street: first?.street ?? "",
      building: first?.building ?? "",
      apartment: first?.apartment ?? "",
      entrance: first?.entrance ?? "",
      floor: first?.floor ?? "",
      comment: first?.comment ?? "",
      deliveryMethod: "",
      payment: payments[0] ?? "CASH_ON_DELIVERY",
      saveAddress: false,
    },
  });
  const { register, watch, setValue, formState } = form;
  const region = watch("region");
  const methodCode = watch("deliveryMethod");

  const available = useMemo(() => delivery.filter((d) => d.regions.length === 0 || d.regions.includes(region)), [delivery, region]);
  useEffect(() => {
    if (!available.some((d) => d.code === methodCode)) setValue("deliveryMethod", available[0]?.code ?? "", { shouldValidate: false });
  }, [available, methodCode, setValue]);

  const method = available.find((d) => d.code === methodCode) ?? null;
  const merchandise = cart.totals.subtotalAmd - cart.totals.discountAmd;
  const shipping = method ? deliveryPrice(method, merchandise) : 0;
  const total = merchandise + shipping;

  const err = (k: keyof CheckoutInput) => {
    const code = formState.errors[k]?.message;
    if (!code) return null;
    return (m.validation as Record<string, string>)[code] ?? m.validation.required;
  };

  const errorText = (code: string): string => {
    const map: Record<string, string> = {
      OUT_OF_STOCK: m.checkout.outOfStock,
      CART_PROBLEM: m.checkout.cartChanged,
      EMPTY_CART: m.cart.empty,
      DELIVERY_INVALID: m.validation.deliveryInvalid,
      PAYMENT_UNAVAILABLE: m.checkout.paymentUnavailable,
      PROMO_INVALID: m.checkout.cartChanged,
      RATE_LIMITED: m.common.rateLimited,
    };
    return map[code] ?? m.common.genericError;
  };

  const onSubmit = form.handleSubmit((values) => {
    setServerError(null);
    track("add_payment_info", { currency: "AMD", value: total, payment_type: values.payment });
    start(async () => {
      let r: CheckoutResult;
      try {
        r = await placeOrderAction(locale, { ...values, idempotencyKey: keyRef.current });
      } catch {
        // Same key on retry: the server returns the existing order if the
        // first attempt actually went through.
        setServerError(m.common.networkError);
        return;
      }
      if (!r.ok) {
        if (r.fields) {
          for (const [k, v] of Object.entries(r.fields)) form.setError(k as keyof CheckoutInput, { message: v });
        }
        setServerError(errorText(r.error));
        if (r.error === "OUT_OF_STOCK" || r.error === "CART_PROBLEM") router.refresh();
        return;
      }
      ui.setCount(0);
      if (r.next.kind === "navigate") {
        router.push(r.next.url);
      } else if (r.next.start.kind === "redirect") {
        setRedirecting(r.next.start);
        window.location.assign(r.next.start.url);
      } else {
        setRedirecting(r.next.start);
      }
    });
  });

  return (
    <>
    <form onSubmit={onSubmit} noValidate className="mt-8 grid gap-10 lg:grid-cols-[1fr_24rem] lg:gap-14">
      <TrackOnMount
        event="begin_checkout"
        params={{ currency: "AMD", value: merchandise, items: cart.lines.map((l) => ({ item_id: l.slug, item_name: l.name, price: l.unitAmd, quantity: l.quantity })) }}
      />
      <div className="space-y-10">
        {sandbox ? <p className="rounded-2xl bg-warn/10 px-4 py-3 text-sm font-medium text-warn">{m.checkout.sandboxNote}</p> : null}

        <Section title={m.checkout.contact}>
          {!signedIn ? (
            <p className="text-sm text-muted">
              {m.account.guestNote}{" "}
              <Link href={paths.signIn(locale)} className="font-semibold text-ink underline underline-offset-4">
                {m.account.signIn}
              </Link>
            </p>
          ) : null}
          <Field label={m.checkout.name} error={err("name")}>
            <input {...register("name")} className="field" autoComplete="name" maxLength={80} aria-invalid={Boolean(err("name"))} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={m.checkout.phone} hint={m.checkout.phoneHint} error={err("phone")}>
              <input {...register("phone")} className="field" type="tel" inputMode="tel" autoComplete="tel" placeholder="+374" maxLength={30} aria-invalid={Boolean(err("phone"))} />
            </Field>
            <Field label={m.checkout.email} optional={m.common.optional} error={err("email")}>
              <input {...register("email")} className="field" type="email" inputMode="email" autoComplete="email" maxLength={120} aria-invalid={Boolean(err("email"))} />
            </Field>
          </div>
        </Section>

        <Section title={m.checkout.address}>
          {addresses.length > 1 ? (
            <div className="flex flex-wrap gap-2">
              {addresses.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className="chip"
                  onClick={() => {
                    for (const k of ["region", "city", "street", "building", "apartment", "entrance", "floor", "comment"] as const) setValue(k, a[k] as never);
                  }}
                >
                  {a.city}, {a.street} {a.building}
                </button>
              ))}
            </div>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={m.checkout.region} error={err("region")}>
              <select {...register("region")} className="field" autoComplete="address-level1">
                {REGION_CODES.map((r) => (
                  <option key={r} value={r}>
                    {m.regions[r]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={m.checkout.city} error={err("city")}>
              <input {...register("city")} className="field" autoComplete="address-level2" maxLength={80} aria-invalid={Boolean(err("city"))} />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
            <Field label={m.checkout.street} error={err("street")}>
              <input {...register("street")} className="field" autoComplete="address-line1" maxLength={120} aria-invalid={Boolean(err("street"))} />
            </Field>
            <Field label={m.checkout.building} error={err("building")}>
              <input {...register("building")} className="field" maxLength={20} aria-invalid={Boolean(err("building"))} />
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <Field label={m.checkout.apartment} optional={m.common.optional}>
              <input {...register("apartment")} className="field" autoComplete="address-line2" maxLength={20} />
            </Field>
            <Field label={m.checkout.entrance} optional={m.common.optional}>
              <input {...register("entrance")} className="field" maxLength={10} />
            </Field>
            <Field label={m.checkout.floor} optional={m.common.optional}>
              <input {...register("floor")} className="field" inputMode="numeric" maxLength={10} />
            </Field>
          </div>
          <Field label={m.checkout.comment} optional={m.common.optional}>
            <textarea {...register("comment")} className="field" rows={2} maxLength={500} />
          </Field>
          {signedIn ? (
            <label className="flex min-h-11 items-center gap-3 text-sm">
              <input type="checkbox" {...register("saveAddress")} className="size-5 accent-ink" />
              {m.checkout.saveAddress}
            </label>
          ) : null}
        </Section>

        <Section title={m.checkout.deliveryMethod}>
          {available.length === 0 ? (
            <p className="rounded-2xl bg-bad/10 px-4 py-3 text-sm text-bad" role="alert">
              {m.checkout.noDeliveryForRegion}
            </p>
          ) : (
            <div className="grid gap-2" role="radiogroup" aria-label={m.checkout.deliveryMethod}>
              {available.map((d) => {
                const price = deliveryPrice(d, merchandise);
                return (
                  <label key={d.code} className="flex min-h-16 cursor-pointer items-center gap-4 rounded-2xl bg-card px-4 py-3 ring-1 ring-line has-[:checked]:ring-2 has-[:checked]:ring-ink">
                    <input type="radio" value={d.code} {...register("deliveryMethod")} className="size-5 accent-ink" />
                    <span className="flex-1">
                      <span className="block font-semibold">{d.name}</span>
                      {d.eta ? <span className="block text-sm text-muted">{d.eta}</span> : null}
                    </span>
                    <span className="font-semibold tabular-nums">{price === 0 ? m.checkout.free : formatAmd(price, locale)}</span>
                  </label>
                );
              })}
            </div>
          )}
          {err("deliveryMethod") ? <p className="text-sm text-bad">{err("deliveryMethod")}</p> : null}
        </Section>

        <Section title={m.checkout.paymentMethod}>
          <div className="grid gap-2" role="radiogroup" aria-label={m.checkout.paymentMethod}>
            {payments.map((p) => (
              <label key={p} className="flex min-h-16 cursor-pointer items-center gap-4 rounded-2xl bg-card px-4 py-3 ring-1 ring-line has-[:checked]:ring-2 has-[:checked]:ring-ink">
                <input type="radio" value={p} {...register("payment")} className="size-5 accent-ink" data-testid={`pay-${p}`} />
                <span className="flex-1">
                  <span className="block font-semibold">{m.checkout.payments[p]}</span>
                  <span className="block text-sm text-muted">{m.checkout.paymentHints[p]}</span>
                </span>
              </label>
            ))}
          </div>
        </Section>
      </div>

      <aside className="lg:sticky lg:top-24 lg:self-start">
        <div className="rounded-[var(--radius-card)] bg-card p-5 ring-1 ring-line">
          <h2 className="font-bold">{m.checkout.summary}</h2>
          <ul className="mt-4 space-y-3">
            {cart.lines.map((l) => (
              <li key={l.id} className="flex items-center gap-3">
                <div className="relative size-14 shrink-0 overflow-hidden rounded-xl" style={{ background: l.accent }}>
                  <ProductImage media={l.image} accent={l.accent} sizes="56px" />
                  <span className="absolute -right-0 -top-0 grid size-5 place-items-center rounded-full bg-ink text-[0.7rem] font-bold text-white">{l.quantity}</span>
                </div>
                <p className="min-w-0 flex-1 truncate text-sm font-medium">{l.name}</p>
                <p className="text-sm font-semibold tabular-nums">{formatAmd(l.lineAmd, locale)}</p>
              </li>
            ))}
          </ul>
          <dl className="mt-5 space-y-2 border-t border-line pt-4 text-sm">
            <Row k={m.cart.subtotal} v={formatAmd(cart.totals.subtotalAmd, locale)} />
            {cart.totals.discountAmd > 0 ? <Row k={`${m.cart.discount}${cart.promoCode ? ` (${cart.promoCode})` : ""}`} v={formatAmd(-cart.totals.discountAmd, locale)} /> : null}
            <Row k={m.cart.delivery} v={method ? (shipping === 0 ? m.checkout.free : formatAmd(shipping, locale)) : "—"} />
            <div className="flex justify-between border-t border-line pt-3 text-base font-bold">
              <dt>{m.cart.total}</dt>
              <dd className="tabular-nums" data-testid="checkout-total">
                {formatAmd(total, locale)}
              </dd>
            </div>
          </dl>
          {serverError ? (
            <p role="alert" className="mt-4 rounded-2xl bg-bad/10 px-4 py-3 text-sm text-bad" data-testid="checkout-error">
              {serverError}
            </p>
          ) : null}
          <button type="submit" className="btn btn-primary mt-5 w-full" disabled={pending || Boolean(redirecting) || available.length === 0} data-testid="place-order">
            {pending || redirecting ? (redirecting ? m.checkout.redirecting : m.checkout.placingOrder) : fmt(m.checkout.placeOrder, { total: formatAmd(total, locale) })}
          </button>
          <p className="mt-3 text-xs leading-relaxed text-muted">
            {m.checkout.agreement}{" "}
            <Link href={paths.page(locale, "terms")} className="underline">
              {m.footer.terms}
            </Link>{" "}
            ·{" "}
            <Link href={paths.page(locale, "privacy")} className="underline">
              {m.footer.privacy}
            </Link>
          </p>
        </div>
      </aside>
    </form>
    {redirecting?.kind === "form" ? <AutoPostForm start={redirecting} m={m} /> : null}
    </>
  );
}

/** Idram-style hosted payment: auto-submitted POST form (with a manual button fallback). */
function AutoPostForm({ start, m }: { start: Extract<PaymentStart, { kind: "form" }>; m: Messages }) {
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => ref.current?.submit(), []);
  return (
    <form ref={ref} method="post" action={start.action} className="mt-6">
      {Object.entries(start.fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <button type="submit" className="btn btn-primary">
        {m.checkout.continueToPayment}
      </button>
    </form>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-4">
      <legend className="mb-4 text-xl font-bold">{title}</legend>
      {children}
    </fieldset>
  );
}

function Field({ label, hint, optional, error, children }: { label: string; hint?: string; optional?: string; error?: string | null; children: React.ReactElement }) {
  return (
    <label className="block">
      <span className="label">
        {label}
        {optional ? <span className="font-normal text-muted"> ({optional})</span> : null}
      </span>
      {children}
      {error ? (
        <span className="mt-1 block text-sm text-bad" role="alert">
          {error}
        </span>
      ) : hint ? (
        <span className="mt-1 block text-xs text-muted">{hint}</span>
      ) : null}
    </label>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-ink-2">{k}</dt>
      <dd className="font-medium tabular-nums">{v}</dd>
    </div>
  );
}
